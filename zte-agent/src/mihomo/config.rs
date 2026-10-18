use std::fs;
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_yaml_ng::{Mapping, Value as YamlValue};
use sha2::{Digest, Sha256};

pub const BASE_DIR: &str = "/data/mihomo";
pub const BIN_DIR: &str = "/data/mihomo/bin";
pub const BIN_PATH: &str = "/data/mihomo/bin/mihomo";
pub const BIN_PREV_PATH: &str = "/data/mihomo/bin/mihomo.prev";
pub const CONFIG_PATH: &str = "/data/mihomo/config.yaml";
pub const CONFIG_PREV_PATH: &str = "/data/mihomo/config.yaml.prev";
pub const RUNTIME_PATH: &str = "/data/mihomo/runtime.yaml";
pub const SETTINGS_PATH: &str = "/data/mihomo/settings.json";
pub const LOG_DIR: &str = "/data/mihomo/logs";
pub const LOG_PATH: &str = "/data/mihomo/logs/mihomo.log";
pub const LOG_PREV_PATH: &str = "/data/mihomo/logs/mihomo.log.1";
pub const RUN_DIR: &str = "/data/mihomo/run";
pub const PID_PATH: &str = "/data/mihomo/run/mihomo.pid";
pub const STATE_DIR: &str = "/data/mihomo/state";
pub const PENDING_PATH: &str = "/data/mihomo/state/pending";
pub const SAFE_MODE_PATH: &str = "/data/mihomo/state/safe_mode";
pub const DOH_PAUSED_PATH: &str = "/data/mihomo/state/doh.conf.paused";
pub const PANIC_PATH: &str = "/data/mihomo/panic.sh";

pub const DEFAULT_CONTROLLER_PORT: u16 = 9091;
pub const DEFAULT_MIXED_PORT: u16 = 7890;
pub const DEFAULT_REDIR_PORT: u16 = 7892;
pub const DEFAULT_DNS_PORT: u16 = 1053;
pub const MAX_CONFIG_BYTES: usize = 1024 * 1024;
pub const MAX_BINARY_BYTES: u64 = 150 * 1024 * 1024;

const PRIVATE_ROUTES: &[&str] = &[
    "0.0.0.0/8",
    "10.0.0.0/8",
    "100.64.0.0/10",
    "127.0.0.0/8",
    "169.254.0.0/16",
    "172.16.0.0/12",
    "192.168.0.0/16",
    "224.0.0.0/4",
    // This firmware's nftables rejects 240.0.0.0/4 as an excluded TUN route
    // with `netlink receive: file exists`; the narrower /8 is accepted.
    "240.0.0.0/8",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MihomoSettings {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default)]
    pub autostart: bool,
    #[serde(default)]
    pub desired_running: bool,
    #[serde(default)]
    pub transparent: bool,
    #[serde(default = "default_mode")]
    pub transparent_mode: String,
    #[serde(default = "default_true")]
    pub block_quic: bool,
    #[serde(default)]
    pub block_ipv6: bool,
    #[serde(default = "default_controller_port")]
    pub controller_port: u16,
    #[serde(default)]
    pub controller_secret: String,
    #[serde(default = "default_mixed_port")]
    pub mixed_port: u16,
    #[serde(default = "default_redir_port")]
    pub redir_port: u16,
    #[serde(default = "default_dns_port")]
    pub dns_port: u16,
    #[serde(default)]
    pub lan_interfaces: Vec<String>,
    #[serde(default)]
    pub last_boot_id: String,
    #[serde(default)]
    pub safe_mode: bool,
    #[serde(default)]
    pub last_error: Option<String>,
    #[serde(default)]
    pub last_started_at: Option<i64>,
    #[serde(default)]
    pub last_effective_mode: Option<String>,
    #[serde(default)]
    pub installed_version: Option<String>,
    #[serde(default)]
    pub binary_sha256: Option<String>,
    #[serde(default)]
    pub binary_size: Option<u64>,
    #[serde(default)]
    pub installed_at: Option<i64>,
    #[serde(default)]
    pub install_source: Option<String>,
}

fn default_schema_version() -> u32 {
    1
}

fn default_mode() -> String {
    "auto".to_string()
}

fn default_true() -> bool {
    true
}

fn default_controller_port() -> u16 {
    DEFAULT_CONTROLLER_PORT
}

fn default_mixed_port() -> u16 {
    DEFAULT_MIXED_PORT
}

fn default_redir_port() -> u16 {
    DEFAULT_REDIR_PORT
}

fn default_dns_port() -> u16 {
    DEFAULT_DNS_PORT
}

impl Default for MihomoSettings {
    fn default() -> Self {
        Self {
            schema_version: default_schema_version(),
            autostart: false,
            desired_running: false,
            transparent: false,
            transparent_mode: default_mode(),
            block_quic: true,
            block_ipv6: false,
            controller_port: default_controller_port(),
            controller_secret: String::new(),
            mixed_port: default_mixed_port(),
            redir_port: default_redir_port(),
            dns_port: default_dns_port(),
            lan_interfaces: Vec::new(),
            last_boot_id: String::new(),
            safe_mode: false,
            last_error: None,
            last_started_at: None,
            last_effective_mode: None,
            installed_version: None,
            binary_sha256: None,
            binary_size: None,
            installed_at: None,
            install_source: None,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct EffectiveConfig {
    pub mixed_port: u16,
    pub redir_port: u16,
    pub dns_port: u16,
    pub tun_table_index: Option<i32>,
    pub tun_rule_index: Option<i32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Direct,
    Tun,
    Redirect,
}

impl Mode {
    pub fn as_str(self) -> &'static str {
        match self {
            Mode::Direct => "direct",
            Mode::Tun => "tun",
            Mode::Redirect => "redirect",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "direct" => Some(Mode::Direct),
            "tun" => Some(Mode::Tun),
            "redirect" => Some(Mode::Redirect),
            _ => None,
        }
    }
}

pub fn mode_valid(s: &str) -> bool {
    matches!(s, "auto" | "tun" | "redirect")
}

pub fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn ensure_dirs() -> Result<(), String> {
    for dir in [BASE_DIR, BIN_DIR, LOG_DIR, RUN_DIR, STATE_DIR] {
        fs::create_dir_all(dir).map_err(|e| format!("create {dir}: {e}"))?;
        let _ = fs::set_permissions(dir, fs::Permissions::from_mode(0o700));
    }
    Ok(())
}

pub fn write_atomic(path: &str, data: &[u8], mode: u32) -> Result<(), String> {
    let dir = Path::new(path).parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let tmp = format!("{path}.tmp.{}", std::process::id());
    {
        let mut file = fs::File::create(&tmp).map_err(|e| format!("create {tmp}: {e}"))?;
        file.write_all(data)
            .map_err(|e| format!("write {tmp}: {e}"))?;
        file.sync_all().map_err(|e| format!("fsync {tmp}: {e}"))?;
    }
    fs::set_permissions(&tmp, fs::Permissions::from_mode(mode))
        .map_err(|e| format!("chmod {tmp}: {e}"))?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("rename {tmp} -> {path}: {e}")
    })
}

pub fn load() -> MihomoSettings {
    let mut settings = fs::read_to_string(SETTINGS_PATH)
        .ok()
        .and_then(|s| serde_json::from_str::<MihomoSettings>(&s).ok())
        .unwrap_or_default();
    if settings.controller_secret.is_empty() {
        settings.controller_secret = random_secret();
        let _ = save(&settings);
    }
    if !mode_valid(&settings.transparent_mode) {
        settings.transparent_mode = "auto".to_string();
    }
    settings
}

pub fn save(settings: &MihomoSettings) -> Result<(), String> {
    let json =
        serde_json::to_string_pretty(settings).map_err(|e| format!("serialize settings: {e}"))?;
    write_atomic(SETTINGS_PATH, json.as_bytes(), 0o600)
}

pub fn random_secret() -> String {
    let mut bytes = [0u8; 32];
    if let Ok(mut f) = fs::File::open("/dev/urandom") {
        use std::io::Read;
        if f.read_exact(&mut bytes).is_ok() {
            return hex(&bytes);
        }
    }
    // Fallback: time + pid + boot id, hashed. Only used if /dev/urandom is unavailable.
    let material = format!(
        "{}:{}:{}:{}",
        unix_now(),
        std::process::id(),
        current_boot_id(),
        std::thread::current().name().unwrap_or("mihomo")
    );
    hex(&Sha256::digest(material.as_bytes())[..32])
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn current_boot_id() -> String {
    fs::read_to_string("/proc/sys/kernel/random/boot_id")
        .map(|s| s.trim().to_string())
        .unwrap_or_default()
}

pub fn read_user_config() -> Option<String> {
    fs::read_to_string(CONFIG_PATH).ok()
}

pub fn write_user_config(yaml: &str) -> Result<(), String> {
    if let Ok(old) = fs::read(CONFIG_PATH) {
        let _ = fs::write(CONFIG_PREV_PATH, old);
    }
    write_atomic(CONFIG_PATH, yaml.as_bytes(), 0o600)
}

pub fn default_config() -> String {
    r#"mixed-port: 7890
allow-lan: false
mode: rule
log-level: info
proxies: []
proxy-groups: []
rules:
  - MATCH,DIRECT
dns:
  enable: true
  listen: 127.0.0.1:1053
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
  default-nameserver: [223.5.5.5, 119.29.29.29]
  nameserver: [223.5.5.5, 119.29.29.29]
  proxy-server-nameserver: [223.5.5.5, 119.29.29.29]
"#
    .to_string()
}

pub fn parse_yaml(text: &str) -> Result<YamlValue, String> {
    if text.len() > MAX_CONFIG_BYTES {
        return Err(format!(
            "config is too large ({} bytes; max {MAX_CONFIG_BYTES})",
            text.len()
        ));
    }
    let value: YamlValue = serde_yaml_ng::from_str(text).map_err(|e| format!("YAML: {e}"))?;
    if !value.is_mapping() {
        return Err("config root must be a YAML mapping".to_string());
    }
    Ok(value)
}

/// Build the runtime YAML from the user's config. The user's file is never
/// modified; only this generated copy receives the transparent-gateway keys.
pub fn build_runtime(
    user_yaml: &str,
    settings: &MihomoSettings,
    mode: Mode,
) -> Result<(String, EffectiveConfig), String> {
    let mut value = parse_yaml(user_yaml)?;
    let root = value
        .as_mapping_mut()
        .ok_or_else(|| "config root must be a YAML mapping".to_string())?;

    set_if_missing(root, "mixed-port", YamlValue::from(settings.mixed_port));

    match mode {
        Mode::Direct => {}
        Mode::Tun => {
            let tun = ensure_map(root, "tun")?;
            set_bool(tun, "enable", true);
            set_if_missing(tun, "stack", YamlValue::from("mixed"));
            set_bool(tun, "auto-route", true);
            set_bool(tun, "auto-redirect", true);
            set_bool(tun, "auto-detect-interface", true);
            set_if_missing(tun, "device", YamlValue::from("mihomo0"));
            set_if_missing(tun, "iproute2-table-index", YamlValue::from(2022u64));
            set_if_missing(tun, "iproute2-rule-index", YamlValue::from(9000u64));
            merge_sequence(tun, "dns-hijack", &["any:53"]);
            merge_sequence(tun, "route-exclude-address", PRIVATE_ROUTES);
            apply_dns(root, settings, true)?;
        }
        Mode::Redirect => {
            let tun = ensure_map(root, "tun")?;
            set_bool(tun, "enable", false);
            set_if_missing(root, "redir-port", YamlValue::from(settings.redir_port));
            apply_dns(root, settings, true)?;
        }
    }

    let text =
        serde_yaml_ng::to_string(&value).map_err(|e| format!("serialize runtime YAML: {e}"))?;
    let effective = extract_effective(&value, settings);
    Ok((text, effective))
}

fn apply_dns(
    root: &mut Mapping,
    settings: &MihomoSettings,
    transparent: bool,
) -> Result<(), String> {
    let dns = ensure_map(root, "dns")?;
    if transparent {
        set_bool(dns, "enable", true);
        set_string(dns, "listen", &format!("127.0.0.1:{}", settings.dns_port));
        set_if_missing(dns, "enhanced-mode", YamlValue::from("fake-ip"));
        set_if_missing(dns, "fake-ip-range", YamlValue::from("198.18.0.1/16"));
    }
    set_if_missing(
        dns,
        "default-nameserver",
        string_seq(&["223.5.5.5", "119.29.29.29"]),
    );
    set_if_missing(
        dns,
        "proxy-server-nameserver",
        string_seq(&["223.5.5.5", "119.29.29.29"]),
    );
    set_if_missing(
        dns,
        "nameserver",
        string_seq(&["223.5.5.5", "119.29.29.29"]),
    );
    Ok(())
}

fn extract_effective(value: &YamlValue, settings: &MihomoSettings) -> EffectiveConfig {
    let mut effective = EffectiveConfig {
        mixed_port: settings.mixed_port,
        redir_port: settings.redir_port,
        dns_port: settings.dns_port,
        ..Default::default()
    };
    let Some(root) = value.as_mapping() else {
        return effective;
    };
    if let Some(port) = root
        .get(&key("mixed-port"))
        .and_then(|v| v.as_u64())
        .and_then(|v| u16::try_from(v).ok())
    {
        effective.mixed_port = port;
    }
    if let Some(port) = root
        .get(&key("redir-port"))
        .and_then(|v| v.as_u64())
        .and_then(|v| u16::try_from(v).ok())
    {
        effective.redir_port = port;
    }
    if let Some(dns) = root.get(&key("dns")).and_then(|v| v.as_mapping()) {
        if let Some(port) = dns
            .get(&key("listen"))
            .and_then(|v| v.as_str())
            .and_then(parse_listen_port)
        {
            effective.dns_port = port;
        }
    }
    if let Some(tun) = root.get(&key("tun")).and_then(|v| v.as_mapping()) {
        effective.tun_table_index = tun
            .get(&key("iproute2-table-index"))
            .and_then(|v| v.as_i64())
            .and_then(|v| i32::try_from(v).ok());
        effective.tun_rule_index = tun
            .get(&key("iproute2-rule-index"))
            .and_then(|v| v.as_i64())
            .and_then(|v| i32::try_from(v).ok());
    }
    effective
}

pub fn effective_from_runtime(text: &str, settings: &MihomoSettings) -> Option<EffectiveConfig> {
    let value = parse_yaml(text).ok()?;
    Some(extract_effective(&value, settings))
}

/// Reject ports that would collide with the agent or dnsmasq. A transparent
/// runtime overrides dns.listen, so port 53 in the user file is harmless in
/// TUN/REDIRECT mode; direct mode is where it would actually conflict.
pub fn check_ports(yaml: &str, settings: &MihomoSettings, mode: Mode) -> Result<(), String> {
    let value = parse_yaml(yaml)?;
    let root = value
        .as_mapping()
        .ok_or_else(|| "config root must be a YAML mapping".to_string())?;
    for name in [
        "mixed-port",
        "port",
        "socks-port",
        "redir-port",
        "tproxy-port",
    ] {
        let Some(port) = root.get(&key(name)).and_then(|v| v.as_u64()) else {
            continue;
        };
        if port > u16::MAX as u64 {
            return Err(format!("{name} {port} is outside the port range"));
        }
        if port == 9090 {
            return Err(format!("{name} 9090 is used by zte-agent"));
        }
        if port == settings.controller_port as u64 {
            return Err(format!(
                "{name} {port} is reserved for the mihomo controller"
            ));
        }
    }
    if let Some(dns) = root.get(&key("dns")).and_then(|v| v.as_mapping()) {
        if let Some(port) = dns
            .get(&key("listen"))
            .and_then(|v| v.as_str())
            .and_then(parse_listen_port)
        {
            if mode == Mode::Direct {
                if port == 53 {
                    return Err(
                        "dns.listen port 53 is used by dnsmasq; use 127.0.0.1:1053 or enable transparent mode"
                            .to_string(),
                    );
                }
                if port == 9090 || port == settings.controller_port {
                    return Err(format!(
                        "dns.listen port {port} is reserved for zte-agent/the mihomo controller"
                    ));
                }
            }
        }
    }
    Ok(())
}

pub fn parse_listen_port(listen: &str) -> Option<u16> {
    let (_, port) = listen.rsplit_once(':')?;
    port.trim().parse::<u16>().ok()
}

fn key(name: &str) -> YamlValue {
    YamlValue::String(name.to_string())
}

fn ensure_map<'a>(root: &'a mut Mapping, name: &str) -> Result<&'a mut Mapping, String> {
    let k = key(name);
    let replace = match root.get(&k) {
        Some(YamlValue::Mapping(_)) => false,
        _ => true,
    };
    if replace {
        root.insert(k.clone(), YamlValue::Mapping(Mapping::new()));
    }
    root.get_mut(&k)
        .and_then(|v| v.as_mapping_mut())
        .ok_or_else(|| format!("{name} must be a mapping"))
}

fn set_bool(map: &mut Mapping, name: &str, value: bool) {
    map.insert(key(name), YamlValue::Bool(value));
}

fn set_string(map: &mut Mapping, name: &str, value: &str) {
    map.insert(key(name), YamlValue::from(value));
}

fn set_if_missing(map: &mut Mapping, name: &str, value: YamlValue) {
    let k = key(name);
    let missing = match map.get(&k) {
        None | Some(YamlValue::Null) => true,
        Some(YamlValue::String(s)) => s.is_empty(),
        Some(YamlValue::Sequence(s)) => s.is_empty(),
        _ => false,
    };
    if missing {
        map.insert(k, value);
    }
}

fn string_seq(values: &[&str]) -> YamlValue {
    YamlValue::Sequence(values.iter().map(|v| YamlValue::from(*v)).collect())
}

fn merge_sequence(map: &mut Mapping, name: &str, values: &[&str]) {
    let k = key(name);
    let mut seq = match map.get(&k) {
        Some(YamlValue::Sequence(existing)) => existing.clone(),
        _ => Vec::new(),
    };
    let mut present: Vec<String> = seq
        .iter()
        .filter_map(|v| v.as_str().map(|s| s.to_string()))
        .collect();
    for value in values {
        if !present.iter().any(|v| v == value) {
            seq.push(YamlValue::from(*value));
            present.push((*value).to_string());
        }
    }
    map.insert(k, YamlValue::Sequence(seq));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setting() -> MihomoSettings {
        MihomoSettings::default()
    }

    fn yaml_value(text: &str) -> YamlValue {
        serde_yaml_ng::from_str(text).unwrap()
    }

    #[test]
    fn defaults_are_safe() {
        let s = setting();
        assert!(!s.autostart);
        assert!(!s.desired_running);
        assert!(!s.transparent);
        assert_eq!(s.transparent_mode, "auto");
        assert!(s.block_quic);
        assert!(!s.block_ipv6);
        assert!(!s.safe_mode);
        assert_eq!(s.controller_port, 9091);
        assert_eq!(s.mixed_port, 7890);
        assert_eq!(s.redir_port, 7892);
        assert_eq!(s.dns_port, 1053);
    }

    #[test]
    fn direct_mode_keeps_user_network_settings() {
        let user =
            "mixed-port: 7891\ntun:\n  enable: true\nproxies: []\nrules:\n  - MATCH,DIRECT\n";
        let (runtime, effective) = build_runtime(user, &setting(), Mode::Direct).unwrap();
        let v = yaml_value(&runtime);
        assert_eq!(v["mixed-port"].as_u64(), Some(7891));
        assert_eq!(v["tun"]["enable"].as_bool(), Some(true));
        assert_eq!(effective.mixed_port, 7891);
    }

    #[test]
    fn tun_mode_injects_gateway_keys_and_preserves_user_config() {
        let user = r#"
mixed-port: 7891
proxies:
  - name: node-a
    type: ss
    server: example.com
    port: 8388
    cipher: aes-128-gcm
    password: secret
proxy-groups:
  - name: PROXY
    type: select
    proxies: [node-a]
rules:
  - DOMAIN-SUFFIX,example.com,PROXY
  - MATCH,DIRECT
dns:
  nameserver: [9.9.9.9]
"#;
        let (runtime, effective) = build_runtime(user, &setting(), Mode::Tun).unwrap();
        let v = yaml_value(&runtime);
        assert_eq!(v["tun"]["enable"].as_bool(), Some(true));
        assert_eq!(v["tun"]["auto-route"].as_bool(), Some(true));
        assert_eq!(v["tun"]["auto-redirect"].as_bool(), Some(true));
        assert_eq!(v["tun"]["dns-hijack"][0].as_str(), Some("any:53"));
        assert!(v["tun"]["route-exclude-address"]
            .as_sequence()
            .unwrap()
            .iter()
            .any(|v| v.as_str() == Some("100.64.0.0/10")));
        assert!(v["tun"]["route-exclude-address"]
            .as_sequence()
            .unwrap()
            .iter()
            .any(|v| v.as_str() == Some("240.0.0.0/8")));
        assert!(!v["tun"]["route-exclude-address"]
            .as_sequence()
            .unwrap()
            .iter()
            .any(|v| v.as_str() == Some("240.0.0.0/4")));
        assert_eq!(v["dns"]["listen"].as_str(), Some("127.0.0.1:1053"));
        assert_eq!(v["dns"]["nameserver"][0].as_str(), Some("9.9.9.9"));
        assert_eq!(v["proxies"][0]["name"].as_str(), Some("node-a"));
        assert_eq!(
            v["rules"][0].as_str(),
            Some("DOMAIN-SUFFIX,example.com,PROXY")
        );
        assert_eq!(effective.dns_port, 1053);
    }

    #[test]
    fn tun_exclusions_avoid_the_nftables_eexist_range() {
        // Regression: 240.0.0.0/4 caused `netlink receive: file exists` on
        // this firmware and made TUN fall back to REDIRECT.
        let (runtime, _) = build_runtime("proxies: []\n", &setting(), Mode::Tun).unwrap();
        let v = yaml_value(&runtime);
        let routes: Vec<&str> = v["tun"]["route-exclude-address"]
            .as_sequence()
            .unwrap()
            .iter()
            .filter_map(|v| v.as_str())
            .collect();
        assert!(routes.contains(&"240.0.0.0/8"));
        assert!(!routes.contains(&"240.0.0.0/4"));
        assert!(routes.contains(&"224.0.0.0/4"));
    }

    #[test]
    fn redirect_mode_disables_tun_and_sets_redir_port() {
        let user = "proxies: []\nrules:\n  - MATCH,DIRECT\n";
        let (runtime, effective) = build_runtime(user, &setting(), Mode::Redirect).unwrap();
        let v = yaml_value(&runtime);
        assert_eq!(v["tun"]["enable"].as_bool(), Some(false));
        assert_eq!(v["redir-port"].as_u64(), Some(7892));
        assert_eq!(v["dns"]["listen"].as_str(), Some("127.0.0.1:1053"));
        assert_eq!(effective.redir_port, 7892);
    }

    #[test]
    fn dns_defaults_are_added_only_when_missing() {
        let user = "dns:\n  nameserver: [1.1.1.1]\n";
        let (runtime, _) = build_runtime(user, &setting(), Mode::Tun).unwrap();
        let v = yaml_value(&runtime);
        assert_eq!(v["dns"]["nameserver"][0].as_str(), Some("1.1.1.1"));
        assert_eq!(
            v["dns"]["default-nameserver"][0].as_str(),
            Some("223.5.5.5")
        );
        assert_eq!(
            v["dns"]["proxy-server-nameserver"][0].as_str(),
            Some("223.5.5.5")
        );
    }

    #[test]
    fn invalid_root_is_rejected() {
        assert!(parse_yaml("- a\n- b\n").is_err());
        assert!(parse_yaml("mixed-port: [").is_err());
    }

    #[test]
    fn port_checks_reject_agent_and_controller_collisions() {
        let s = setting();
        assert!(check_ports("mixed-port: 7890\n", &s, Mode::Direct).is_ok());
        assert!(check_ports("mixed-port: 9090\n", &s, Mode::Direct).is_err());
        assert!(check_ports("redir-port: 9091\n", &s, Mode::Redirect).is_err());
        assert!(check_ports("dns:\n  listen: 0.0.0.0:53\n", &s, Mode::Direct).is_err());
        assert!(check_ports("dns:\n  listen: 0.0.0.0:53\n", &s, Mode::Tun).is_ok());
    }

    #[test]
    fn tun_runtime_sets_explicit_route_table_for_cleanup() {
        let user = "proxies: []\n";
        let (runtime, effective) = build_runtime(user, &setting(), Mode::Tun).unwrap();
        let v = yaml_value(&runtime);
        assert_eq!(v["tun"]["iproute2-table-index"].as_u64(), Some(2022));
        assert_eq!(v["tun"]["iproute2-rule-index"].as_u64(), Some(9000));
        assert_eq!(effective.tun_table_index, Some(2022));
        assert_eq!(effective.tun_rule_index, Some(9000));
    }

    #[test]
    fn listen_port_parser_handles_ipv4_ipv6_and_hostnames() {
        assert_eq!(parse_listen_port("127.0.0.1:1053"), Some(1053));
        assert_eq!(parse_listen_port("0.0.0.0:53"), Some(53));
        assert_eq!(parse_listen_port("[::1]:1053"), Some(1053));
        assert_eq!(parse_listen_port("localhost:5353"), Some(5353));
        assert_eq!(parse_listen_port("bad"), None);
    }
}
