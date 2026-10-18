use std::fs::{self, File};
use std::io::{Read, Write};

use serde_json::{json, Value};
use tiny_http::Request;

use super::binary;
use super::config;
use crate::handlers::AppState;

fn ok(data: Value) -> (u16, Value) {
    (200, json!({"ok": true, "data": data}))
}

fn error(status: u16, message: impl Into<String>) -> (u16, Value) {
    (status, json!({"ok": false, "error": message.into()}))
}

fn map_op_error(message: String) -> (u16, Value) {
    if message.contains("not installed") {
        error(503, message)
    } else if message.contains("too large") {
        error(413, message)
    } else {
        error(500, message)
    }
}

fn map_config_error(message: String) -> (u16, Value) {
    if message.contains("not installed") {
        error(503, message)
    } else if message.contains("too large") {
        error(413, message)
    } else {
        error(400, message)
    }
}

pub fn status(state: &AppState) -> (u16, Value) {
    ok(state.mihomo.status())
}

pub fn capabilities(state: &AppState) -> (u16, Value) {
    ok(state.mihomo.capabilities(false))
}

pub fn capabilities_force(state: &AppState) -> (u16, Value) {
    ok(state.mihomo.capabilities(true))
}

pub fn settings_get(state: &AppState) -> (u16, Value) {
    ok(state.mihomo.settings_json_for_api())
}

pub fn settings_set(state: &AppState, body: &[u8]) -> (u16, Value) {
    let patch: Value = match serde_json::from_slice(body) {
        Ok(v) => v,
        Err(_) => return error(400, "invalid JSON"),
    };
    match state.mihomo.update_settings(&patch) {
        Ok(v) => ok(v),
        Err(e) => error(400, e),
    }
}

pub fn config_get(state: &AppState) -> (u16, Value) {
    match state.mihomo.config_get() {
        Ok(v) => ok(v),
        Err(e) => error(500, e),
    }
}

pub fn config_set(state: &AppState, body: &[u8]) -> (u16, Value) {
    let text = match std::str::from_utf8(body) {
        Ok(v) => v,
        Err(_) => return error(400, "config must be UTF-8 YAML"),
    };
    match state.mihomo.config_save(text) {
        Ok(v) => ok(v),
        Err(e) => map_config_error(e),
    }
}

pub fn config_validate(state: &AppState, body: &[u8]) -> (u16, Value) {
    let text = match std::str::from_utf8(body) {
        Ok(v) => v,
        Err(_) => return error(400, "config must be UTF-8 YAML"),
    };
    match state.mihomo.config_validate(text) {
        Ok(v) => ok(v),
        Err(e) => map_config_error(e),
    }
}

pub fn start(state: &AppState) -> (u16, Value) {
    match state.mihomo.start() {
        Ok(v) => ok(v),
        Err(e) => map_op_error(e),
    }
}

pub fn stop(state: &AppState) -> (u16, Value) {
    match state.mihomo.stop() {
        Ok(v) => ok(v),
        Err(e) => map_op_error(e),
    }
}

pub fn restart(state: &AppState) -> (u16, Value) {
    match state.mihomo.restart() {
        Ok(v) => ok(v),
        Err(e) => map_op_error(e),
    }
}

pub fn panic(state: &AppState) -> (u16, Value) {
    match state.mihomo.panic() {
        Ok(v) => ok(v),
        Err(e) => map_op_error(e),
    }
}

pub fn safe_mode_clear(state: &AppState) -> (u16, Value) {
    match state.mihomo.clear_safe_mode() {
        Ok(v) => ok(v),
        Err(e) => error(500, e),
    }
}

pub fn logs(state: &AppState, lines: usize) -> (u16, Value) {
    ok(state.mihomo.logs(lines))
}

pub fn logs_clear(state: &AppState) -> (u16, Value) {
    match state.mihomo.clear_logs() {
        Ok(v) => ok(v),
        Err(e) => error(500, e),
    }
}

pub fn install_download(state: &AppState, body: &[u8]) -> (u16, Value) {
    let parsed: Value = match serde_json::from_slice(body) {
        Ok(v) => v,
        Err(_) => return error(400, "invalid JSON"),
    };
    let version = parsed["version"].as_str().unwrap_or("").trim();
    if version.is_empty() {
        return error(400, "missing version");
    }
    let sha = parsed["sha256"].as_str().unwrap_or("");
    match state.mihomo.install_download(version, sha) {
        Ok(v) => ok(v),
        Err(e) => map_op_error(e),
    }
}

/// Stream the upload to disk before validating it. This must run before the
/// generic request body reader so a 55 MB binary never lands in memory.
pub fn install_upload(request: &mut Request, state: &AppState) -> (u16, Value) {
    let content_length = request
        .headers()
        .iter()
        .find(|h| {
            h.field
                .as_str()
                .as_str()
                .eq_ignore_ascii_case("content-length")
        })
        .and_then(|h| h.value.as_str().trim().parse::<u64>().ok());
    if let Some(len) = content_length {
        if len > config::MAX_BINARY_BYTES {
            return error(
                413,
                format!(
                    "binary is too large ({} bytes; max {})",
                    len,
                    config::MAX_BINARY_BYTES
                ),
            );
        }
    }
    if let Err(e) = config::ensure_dirs() {
        return error(500, e);
    }
    let temp = format!(
        "{}/.upload-{}-{}.bin",
        config::BASE_DIR,
        std::process::id(),
        config::unix_now()
    );
    let result = (|| -> Result<Value, String> {
        let mut file = File::create(&temp).map_err(|e| format!("create {temp}: {e}"))?;
        let copied = {
            let reader = request.as_reader();
            std::io::copy(&mut reader.take(config::MAX_BINARY_BYTES + 1), &mut file)
                .map_err(|e| format!("read upload: {e}"))?
        };
        let _ = file.flush();
        drop(file);
        if copied == 0 {
            return Err("empty upload".to_string());
        }
        if copied > config::MAX_BINARY_BYTES {
            return Err(format!(
                "binary is too large (max {} bytes)",
                config::MAX_BINARY_BYTES
            ));
        }
        let prepared = binary::prepare_uploaded_binary(&temp)?;
        let installed = match binary::install_from_path(&prepared, "upload") {
            Ok(v) => v,
            Err(e) => {
                let _ = fs::remove_file(&prepared);
                return Err(e);
            }
        };
        if prepared != temp {
            let _ = fs::remove_file(&prepared);
        }
        state.mihomo.record_install(installed)
    })();
    let _ = fs::remove_file(&temp);
    match result {
        Ok(v) => ok(v),
        Err(e) => map_op_error(e),
    }
}
