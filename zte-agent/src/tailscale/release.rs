use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

const INDEX_URL: &str = "https://pkgs.tailscale.com/stable/?mode=json";
const CACHE_TTL_SECS: i64 = 300;

static CACHE: Mutex<Option<(i64, Value)>> = Mutex::new(None);

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn cached() -> Option<Value> {
    let guard = CACHE.lock().ok()?;
    let (at, value) = guard.as_ref()?;
    if unix_now().saturating_sub(*at) < CACHE_TTL_SECS {
        Some(value.clone())
    } else {
        None
    }
}

fn store(value: &Value) {
    if let Ok(mut guard) = CACHE.lock() {
        *guard = Some((unix_now(), value.clone()));
    }
}

/// GET /api/tailscale/release — resolve the current stable arm64 tarball and
/// its SHA256. The browser cannot query pkgs.tailscale.com directly because
/// the response has no CORS headers.
pub fn handler() -> (u16, Value) {
    if let Some(value) = cached() {
        return (200, json!({"ok": true, "data": value}));
    }
    match fetch() {
        Ok(value) => {
            store(&value);
            (200, json!({"ok": true, "data": value}))
        }
        Err(e) => (502, json!({"ok": false, "error": e})),
    }
}

fn fetch() -> Result<Value, String> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(20)))
        .build()
        .into();

    let mut index_response = agent
        .get(INDEX_URL)
        .call()
        .map_err(|e| format!("fetch {INDEX_URL}: {e}"))?;
    let index_body = index_response
        .body_mut()
        .read_to_vec()
        .map_err(|e| format!("read release index: {e}"))?;
    let index_text = String::from_utf8_lossy(&index_body);
    let (version, tarball) = parse_index(&index_text)?;

    let sha_url = format!("https://pkgs.tailscale.com/stable/tailscale_{version}_arm64.tgz.sha256");
    let mut sha_response = agent
        .get(&sha_url)
        .call()
        .map_err(|e| format!("fetch {sha_url}: {e}"))?;
    let sha_body = sha_response
        .body_mut()
        .read_to_vec()
        .map_err(|e| format!("read release checksum: {e}"))?;
    let sha_text = String::from_utf8_lossy(&sha_body);
    let sha256 = parse_sha(&sha_text)?;

    Ok(json!({
        "version": version,
        "sha256": sha256,
        "arch": "arm64",
        "tarball": tarball,
    }))
}

pub fn parse_index(body: &str) -> Result<(String, String), String> {
    let value: Value =
        serde_json::from_str(body).map_err(|e| format!("parse release index: {e}"))?;
    let version = value["TarballsVersion"]
        .as_str()
        .ok_or_else(|| "release index has no TarballsVersion".to_string())?;
    if version.is_empty() || !version.chars().all(|c| c.is_ascii_digit() || c == '.') {
        return Err(format!("unexpected Tailscale version: {version}"));
    }
    let tarball = value["Tarballs"]["arm64"]
        .as_str()
        .ok_or_else(|| "release index has no arm64 tarball".to_string())?;
    if !tarball.contains("arm64") || !tarball.ends_with(".tgz") {
        return Err(format!("unexpected arm64 tarball name: {tarball}"));
    }
    Ok((version.to_string(), tarball.to_string()))
}

pub fn parse_sha(body: &str) -> Result<String, String> {
    let first = body
        .split_whitespace()
        .next()
        .ok_or_else(|| "empty checksum response".to_string())?
        .to_ascii_lowercase();
    if first.len() != 64 || !first.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(format!("invalid checksum: {first}"));
    }
    Ok(first)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_stable_index_for_arm64() {
        let body = r#"{
            "TarballsVersion": "1.98.9",
            "Tarballs": {
                "amd64": "tailscale_1.98.9_amd64.tgz",
                "arm64": "tailscale_1.98.9_arm64.tgz"
            }
        }"#;
        let (version, tarball) = parse_index(body).unwrap();
        assert_eq!(version, "1.98.9");
        assert_eq!(tarball, "tailscale_1.98.9_arm64.tgz");
    }

    #[test]
    fn rejects_missing_or_invalid_arm64_release() {
        assert!(parse_index(r#"{"TarballsVersion":"1.98.9","Tarballs":{}}"#).is_err());
        assert!(parse_index(
            r#"{"TarballsVersion":"v1.98.9","Tarballs":{"arm64":"tailscale_1.98.9_arm64.tgz"}}"#
        )
        .is_err());
        assert!(parse_index(
            r#"{"TarballsVersion":"1.98.9","Tarballs":{"arm64":"tailscale_1.98.9_amd64.tgz"}}"#
        )
        .is_err());
    }

    #[test]
    fn parses_bare_and_sidecar_checksums() {
        let hash = "a".repeat(64);
        assert_eq!(parse_sha(&hash).unwrap(), hash);
        assert_eq!(
            parse_sha(&format!("{hash}  tailscale_1.98.9_arm64.tgz\n")).unwrap(),
            hash
        );
        assert!(parse_sha("not-a-hash").is_err());
        assert!(parse_sha(&"a".repeat(63)).is_err());
    }
}
