use std::fs::{self, File};
use std::io::Read;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::{Command, Output, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use sha2::{Digest, Sha256};

use super::config;

const MAX_OUTPUT_BYTES: usize = 8 * 1024;

#[derive(Debug, Clone)]
pub struct InstalledBinary {
    pub version: String,
    pub sha256: String,
    pub size: u64,
    pub source: String,
}

/// Official static aarch64 builds. gz checksum is checked before decompression,
/// bin checksum after; both were measured from the v1.19.32 release assets.
const PINNED: &[(&str, &str, &str)] = &[(
    "v1.19.32",
    "9dd862e28b46ff7d775f169cceebc28deccaa0a9e804237d421cd2571e0caba0",
    "c80df2ca5159567804da883401e0118908fc1155e05df2baf3dbd4d3ecfc3754",
)];

pub fn installed() -> bool {
    Path::new(config::BIN_PATH).is_file()
}

pub fn normalize_version(version: &str) -> Result<String, String> {
    let trimmed = version.trim();
    let core = trimmed.strip_prefix('v').unwrap_or(trimmed);
    let parts: Vec<&str> = core.split('.').collect();
    if parts.len() != 3
        || parts
            .iter()
            .any(|p| p.is_empty() || !p.chars().all(|c| c.is_ascii_digit()))
    {
        return Err(format!("invalid version: {version}"));
    }
    Ok(format!("v{core}"))
}

pub fn pinned_checksums(version: &str) -> Option<(&'static str, &'static str)> {
    PINNED
        .iter()
        .find(|(v, _, _)| *v == version)
        .map(|(_, gz, bin)| (*gz, *bin))
}

pub fn sha256_file(path: &str) -> Result<String, String> {
    let mut file = File::open(path).map_err(|e| format!("open {path}: {e}"))?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file
            .read(&mut buf)
            .map_err(|e| format!("read {path}: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn sha256_bytes(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

/// Validate the ELF header and AArch64 machine type. Dynamic binaries are
/// allowed (a custom musl build may carry an interpreter); scripts and other
/// architectures are not.
pub fn validate_elf(path: &str) -> Result<(), String> {
    let mut file = File::open(path).map_err(|e| format!("open {path}: {e}"))?;
    let mut header = [0u8; 64];
    file.read_exact(&mut header)
        .map_err(|e| format!("read ELF header: {e}"))?;
    if &header[0..4] != b"\x7fELF" {
        return Err("not an ELF binary".to_string());
    }
    if header[4] != 2 {
        return Err("not a 64-bit ELF".to_string());
    }
    if header[5] != 1 {
        return Err("not a little-endian ELF".to_string());
    }
    let e_type = u16::from_le_bytes([header[16], header[17]]);
    if e_type != 2 && e_type != 3 {
        return Err(format!("unexpected ELF type {e_type}"));
    }
    let machine = u16::from_le_bytes([header[18], header[19]]);
    if machine != 183 {
        return Err(format!(
            "wrong architecture: ELF machine {machine}, expected AArch64 (183)"
        ));
    }
    Ok(())
}

pub fn is_gzip(path: &str) -> Result<bool, String> {
    let mut file = File::open(path).map_err(|e| format!("open {path}: {e}"))?;
    let mut magic = [0u8; 2];
    match file.read_exact(&mut magic) {
        Ok(()) => Ok(magic == [0x1f, 0x8b]),
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => Ok(false),
        Err(e) => Err(format!("read {path}: {e}")),
    }
}

fn run_with_timeout(mut cmd: Command, timeout_secs: u64) -> Result<Output, String> {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let child = cmd.spawn().map_err(|e| format!("spawn: {e}"))?;
    let pid = child.id();
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });
    match rx.recv_timeout(Duration::from_secs(timeout_secs)) {
        Ok(result) => result.map_err(|e| format!("wait: {e}")),
        Err(_) => {
            unsafe {
                libc::kill(pid as i32, libc::SIGKILL);
            }
            Err(format!("timed out after {timeout_secs}s"))
        }
    }
}

fn output_tail(stdout: &[u8], stderr: &[u8]) -> String {
    let mut text = String::new();
    if !stderr.is_empty() {
        text.push_str(&String::from_utf8_lossy(stderr));
    }
    if !stdout.is_empty() {
        if !text.is_empty() {
            text.push('\n');
        }
        text.push_str(&String::from_utf8_lossy(stdout));
    }
    let trimmed = text.trim();
    if trimmed.len() > MAX_OUTPUT_BYTES {
        let start = trimmed.len() - MAX_OUTPUT_BYTES;
        format!("…{}", &trimmed[start..])
    } else {
        trimmed.to_string()
    }
}

pub fn version_of(path: &str) -> Result<String, String> {
    let mut cmd = Command::new(path);
    cmd.arg("-v");
    let out = run_with_timeout(cmd, 10)?;
    if !out.status.success() {
        return Err(format!(
            "mihomo -v failed: {}",
            output_tail(&out.stdout, &out.stderr)
        ));
    }
    let text = format!(
        "{} {}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    for token in text.split_whitespace() {
        let candidate = token.trim_matches(|c: char| !c.is_ascii_digit() && c != 'v' && c != '.');
        if let Ok(version) = normalize_version(candidate) {
            return Ok(version);
        }
    }
    Err(format!(
        "could not parse mihomo version from: {}",
        text.trim()
    ))
}

pub fn test_config(runtime_path: &str) -> Result<(), String> {
    let mut cmd = Command::new(config::BIN_PATH);
    cmd.args(["-t", "-d", config::BASE_DIR, "-f", runtime_path]);
    let out = run_with_timeout(cmd, 20)?;
    if out.status.success() {
        Ok(())
    } else {
        Err(format!(
            "mihomo config test failed: {}",
            output_tail(&out.stdout, &out.stderr)
        ))
    }
}

fn decompress_gzip(src: &str, dst: &str) -> Result<(), String> {
    let out = File::create(dst).map_err(|e| format!("create {dst}: {e}"))?;
    let status = Command::new("gzip")
        .args(["-dc", src])
        .stdout(Stdio::from(out))
        .stderr(Stdio::piped())
        .status()
        .map_err(|e| format!("run gzip: {e}"))?;
    if !status.success() {
        return Err("gzip decompression failed".to_string());
    }
    Ok(())
}

fn temp_path(suffix: &str) -> String {
    format!(
        "{}/.mihomo-{}-{}.{}",
        config::BASE_DIR,
        std::process::id(),
        config::unix_now(),
        suffix
    )
}

fn file_size(path: &str) -> Result<u64, String> {
    fs::metadata(path)
        .map(|m| m.len())
        .map_err(|e| format!("stat {path}: {e}"))
}

pub fn install_from_path(src: &str, source: &str) -> Result<InstalledBinary, String> {
    let size = file_size(src)?;
    if size == 0 || size > config::MAX_BINARY_BYTES {
        return Err(format!("binary size {size} is outside the allowed range"));
    }
    validate_elf(src)?;
    let version = version_of(src)?;
    let sha256 = sha256_file(src)?;
    config::ensure_dirs()?;

    let tmp = format!("{}.new.{}", config::BIN_PATH, std::process::id());
    fs::copy(src, &tmp).map_err(|e| format!("copy binary: {e}"))?;
    fs::set_permissions(&tmp, fs::Permissions::from_mode(0o755))
        .map_err(|e| format!("chmod {tmp}: {e}"))?;
    if Path::new(config::BIN_PATH).exists() {
        let _ = fs::copy(config::BIN_PATH, config::BIN_PREV_PATH);
    }
    fs::rename(&tmp, config::BIN_PATH).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("install binary: {e}")
    })?;
    let _ = fs::remove_file(src);

    Ok(InstalledBinary {
        version,
        sha256,
        size,
        source: source.to_string(),
    })
}

pub fn download_and_install(version: &str, sha256: &str) -> Result<InstalledBinary, String> {
    let version = normalize_version(version)?;
    let (pinned_gz, pinned_bin) = match pinned_checksums(&version) {
        Some(v) => (Some(v.0), Some(v.1)),
        None => (None, None),
    };
    let expected_gz: String = if sha256.trim().is_empty() {
        pinned_gz
            .ok_or_else(|| format!("no built-in checksum for {version}; provide the .gz SHA256"))?
            .to_string()
    } else {
        let s = sha256.trim().to_ascii_lowercase();
        if s.len() != 64 || !s.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err("sha256 must be 64 hex characters".to_string());
        }
        s
    };

    let url = format!(
        "https://github.com/MetaCubeX/mihomo/releases/download/{version}/mihomo-linux-arm64-{version}.gz"
    );
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(180)))
        .build()
        .into();
    let mut response = agent
        .get(&url)
        .call()
        .map_err(|e| format!("download {url}: {e}"))?;
    if response.status().as_u16() != 200 {
        return Err(format!(
            "download {url}: HTTP {}",
            response.status().as_u16()
        ));
    }
    let body = response
        .body_mut()
        .read_to_vec()
        .map_err(|e| format!("read download: {e}"))?;
    if body.is_empty() || body.len() as u64 > config::MAX_BINARY_BYTES {
        return Err("downloaded archive is empty or too large".to_string());
    }
    let actual_gz = sha256_bytes(&body);
    if actual_gz != expected_gz {
        return Err(format!(
            "download checksum mismatch: expected {expected_gz}, got {actual_gz}"
        ));
    }

    config::ensure_dirs()?;
    let gz_path = temp_path("gz");
    let bin_path = temp_path("bin");
    fs::write(&gz_path, &body).map_err(|e| format!("write {gz_path}: {e}"))?;
    if let Err(e) = decompress_gzip(&gz_path, &bin_path) {
        let _ = fs::remove_file(&gz_path);
        return Err(e);
    }
    let _ = fs::remove_file(&gz_path);
    if let Some(expected_bin) = pinned_bin {
        let actual_bin = sha256_file(&bin_path)?;
        if actual_bin != expected_bin {
            let _ = fs::remove_file(&bin_path);
            return Err(format!(
                "binary checksum mismatch: expected {expected_bin}, got {actual_bin}"
            ));
        }
    }
    let result = install_from_path(&bin_path, &format!("download {version}"));
    if result.is_err() {
        let _ = fs::remove_file(&bin_path);
    }
    result
}

/// Used by the upload handler after the raw body (or gzip body) has been
/// written to a temp file.
pub fn prepare_uploaded_binary(temp: &str) -> Result<String, String> {
    if is_gzip(temp)? {
        let out = format!("{temp}.bin");
        if let Err(e) = decompress_gzip(temp, &out) {
            let _ = fs::remove_file(&out);
            let _ = fs::remove_file(temp);
            return Err(e);
        }
        let _ = fs::remove_file(temp);
        let size = file_size(&out)?;
        if size == 0 || size > config::MAX_BINARY_BYTES {
            let _ = fs::remove_file(&out);
            return Err(format!(
                "decompressed binary size {size} is outside the allowed range"
            ));
        }
        Ok(out)
    } else {
        Ok(temp.to_string())
    }
}

pub fn logs_tail(lines: usize) -> String {
    let limit = lines.clamp(1, 2000);
    match fs::read(config::LOG_PATH) {
        Ok(bytes) => {
            let text = String::from_utf8_lossy(&bytes);
            let mut all: Vec<&str> = text.lines().collect();
            if all.len() > limit {
                all = all[all.len() - limit..].to_vec();
            }
            all.join("\n")
        }
        Err(_) => String::new(),
    }
}

pub fn clear_logs() -> Result<(), String> {
    let file = File::create(config::LOG_PATH).map_err(|e| format!("truncate log: {e}"))?;
    drop(file);
    let _ = fs::set_permissions(config::LOG_PATH, fs::Permissions::from_mode(0o640));
    Ok(())
}

pub fn rotate_log() {
    if let Ok(meta) = fs::metadata(config::LOG_PATH) {
        if meta.len() > 5 * 1024 * 1024 {
            let _ = fs::rename(config::LOG_PATH, config::LOG_PREV_PATH);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write as _;

    fn temp_elf(machine: u16) -> String {
        let path = std::env::temp_dir().join(format!(
            "mihomo-elf-test-{}-{}.bin",
            std::process::id(),
            config::unix_now()
        ));
        let mut header = [0u8; 64];
        header[0..4].copy_from_slice(b"\x7fELF");
        header[4] = 2;
        header[5] = 1;
        header[6] = 1;
        header[16..18].copy_from_slice(&2u16.to_le_bytes());
        header[18..20].copy_from_slice(&machine.to_le_bytes());
        let mut file = File::create(&path).unwrap();
        file.write_all(&header).unwrap();
        path.to_string_lossy().to_string()
    }

    #[test]
    fn accepts_aarch64_elf_and_rejects_other_architectures() {
        let ok = temp_elf(183);
        assert!(validate_elf(&ok).is_ok());
        let _ = fs::remove_file(&ok);

        let wrong = temp_elf(62);
        assert!(validate_elf(&wrong).is_err());
        let _ = fs::remove_file(&wrong);
    }

    #[test]
    fn rejects_non_elf_files() {
        let path = std::env::temp_dir().join(format!("mihomo-not-elf-{}", std::process::id()));
        fs::write(&path, b"#!/bin/sh\necho hi\n").unwrap();
        assert!(validate_elf(path.to_str().unwrap()).is_err());
        let _ = fs::remove_file(path);
    }

    #[test]
    fn version_normalization() {
        assert_eq!(normalize_version("v1.19.32").unwrap(), "v1.19.32");
        assert_eq!(normalize_version("1.19.32").unwrap(), "v1.19.32");
        assert_eq!(normalize_version("  v1.19.32 ").unwrap(), "v1.19.32");
        assert!(normalize_version("latest").is_err());
        assert!(normalize_version("v1.2").is_err());
        assert!(normalize_version("v1.2.x").is_err());
    }

    #[test]
    fn pinned_checksum_table_matches_version_normalization() {
        let (gz, bin) = pinned_checksums("v1.19.32").unwrap();
        assert_eq!(gz.len(), 64);
        assert_eq!(bin.len(), 64);
        assert!(pinned_checksums("v9.9.9").is_none());
    }
}
