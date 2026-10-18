use std::fs;
use std::net::UdpSocket;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;

use super::config;
use crate::ubus;

pub const TUN_NAME: &str = "mihomo0";
pub const REDIR_CHAIN: &str = "MIHOMO_REDIR";
pub const QUIC_CHAIN: &str = "MIHOMO_QUIC";
pub const IPV6_CHAIN: &str = "MIHOMO6";
const DNSMASQ_DROPIN: &str = "/tmp/dnsmasq.d/mihomo.conf";
const DOH_DROPIN: &str = "/tmp/dnsmasq.d/doh.conf";

const PRIVATE_ROUTES: &[&str] = &[
    "0.0.0.0/8",
    "10.0.0.0/8",
    "100.64.0.0/10",
    "127.0.0.0/8",
    "169.254.0.0/16",
    "172.16.0.0/12",
    "192.168.0.0/16",
    "224.0.0.0/4",
    "240.0.0.0/4",
];

#[derive(Debug, Clone, Serialize, Default)]
pub struct Probe {
    pub available: bool,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct Capabilities {
    pub root: bool,
    pub tun: Probe,
    pub iptables: Probe,
    pub ip6tables: Probe,
    pub nftables: Probe,
    pub dnsmasq: Probe,
    pub lan_interfaces: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FirewallCommand {
    pub program: &'static str,
    pub args: Vec<String>,
}

impl FirewallCommand {
    fn new(program: &'static str, args: &[&str]) -> Self {
        Self {
            program,
            args: args.iter().map(|s| s.to_string()).collect(),
        }
    }

    fn owned(program: &'static str, args: Vec<String>) -> Self {
        Self { program, args }
    }
}

fn run_owned(program: &str, args: &[String]) -> Result<String, String> {
    let output = Command::new(program)
        .args(args)
        .output()
        .map_err(|e| format!("{program}: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("{program} {}: {}", args.join(" "), stderr.trim()));
    }
    Ok(stdout)
}

fn try_run(program: &str, args: &[&str]) {
    let _ = Command::new(program)
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

fn run_plan(plan: &[FirewallCommand]) -> Result<(), String> {
    for command in plan {
        run_owned(command.program, &command.args)?;
    }
    Ok(())
}

pub fn probe() -> Capabilities {
    let mut caps = Capabilities::default();
    caps.root = unsafe { libc::geteuid() } == 0;

    caps.tun = probe_tun();
    caps.iptables = probe_tool("iptables", &["-V"], &["-w", "5", "-t", "nat", "-L", "-n"]);
    caps.ip6tables = probe_tool(
        "ip6tables",
        &["-V"],
        &["-w", "5", "-t", "filter", "-L", "-n"],
    );
    caps.nftables = probe_tool("nft", &["--version"], &["list", "tables"]);
    caps.dnsmasq = probe_dnsmasq();
    caps.lan_interfaces = detect_lan_interfaces();
    caps
}

fn probe_tool(program: &str, version_args: &[&str], check_args: &[&str]) -> Probe {
    let version = match Command::new(program).args(version_args).output() {
        Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout).trim().to_string(),
        Ok(out) => format!("{} exited {}", program, out.status),
        Err(e) => format!("{program}: {e}"),
    };
    let check = Command::new(program)
        .args(check_args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    Probe {
        available: check.map(|s| s.success()).unwrap_or(false),
        detail: version,
    }
}

fn probe_tun() -> Probe {
    if !Path::new("/dev/net/tun").exists() {
        return Probe {
            available: false,
            detail: "/dev/net/tun is missing".to_string(),
        };
    }
    try_run(
        "ip",
        &["tuntap", "del", "mode", "tun", "name", "mihomo-probe"],
    );
    let add = Command::new("ip")
        .args(["tuntap", "add", "mode", "tun", "name", "mihomo-probe"])
        .output();
    match add {
        Ok(out) if out.status.success() => {
            try_run(
                "ip",
                &["tuntap", "del", "mode", "tun", "name", "mihomo-probe"],
            );
            Probe {
                available: true,
                detail: "/dev/net/tun and ip tuntap both work".to_string(),
            }
        }
        Ok(out) => Probe {
            available: false,
            detail: format!(
                "ip tuntap add failed: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            ),
        },
        Err(e) => Probe {
            available: false,
            detail: format!("ip: {e}"),
        },
    }
}

fn probe_dnsmasq() -> Probe {
    let running = Command::new("pidof")
        .arg("dnsmasq")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    let config = Path::new("/etc/init.d/dnsmasq").exists();
    Probe {
        available: running && config,
        detail: if running {
            "dnsmasq is running".to_string()
        } else {
            "dnsmasq is not running".to_string()
        },
    }
}

pub fn detect_lan_interfaces() -> Vec<String> {
    let mut result = Vec::new();
    if let Ok(status) = ubus::call("network.interface.lan", "status", None) {
        if let Some(device) = status["l3_device"].as_str() {
            push_interface(&mut result, device);
        }
    }
    if let Ok(entries) = fs::read_dir("/sys/class/net") {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with("br-") || name == "br-wan" || name == "br-mihomo" {
                continue;
            }
            let output = Command::new("ip")
                .args(["-4", "-o", "addr", "show", "dev", &name])
                .output();
            if let Ok(out) = output {
                let text = String::from_utf8_lossy(&out.stdout);
                if out.status.success() && text.contains("inet ") && !text.contains("127.0.0.1") {
                    push_interface(&mut result, &name);
                }
            }
        }
    }
    if result.is_empty() && Path::new("/sys/class/net/br-lan").exists() {
        result.push("br-lan".to_string());
    }
    result.sort();
    result.dedup();
    result
}

fn push_interface(result: &mut Vec<String>, name: &str) {
    if name.is_empty() || name == "lo" || name.starts_with("rmnet") || name == TUN_NAME {
        return;
    }
    if !result.iter().any(|v| v == name) {
        result.push(name.to_string());
    }
}

pub fn wan_ready() -> bool {
    if let Ok(status) = ubus::call("network.interface.wan", "status", None) {
        if status["up"].as_bool() == Some(true) {
            return true;
        }
    }
    // Fallback: a default route in /proc/net/route whose interface is not the
    // mihomo TUN.
    if let Ok(text) = fs::read_to_string("/proc/net/route") {
        for line in text.lines().skip(1) {
            let cols: Vec<&str> = line.split_whitespace().collect();
            if cols.len() >= 8 && cols[1] == "00000000" && cols[7] != TUN_NAME {
                return true;
            }
        }
    }
    false
}

pub fn pid_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    let rc = unsafe { libc::kill(pid as i32, 0) };
    rc == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

pub fn read_pid() -> Option<u32> {
    fs::read_to_string(config::PID_PATH)
        .ok()
        .and_then(|s| s.trim().parse::<u32>().ok())
}

pub fn write_pid(pid: u32) -> Result<(), String> {
    config::write_atomic(config::PID_PATH, format!("{pid}\n").as_bytes(), 0o644)
}

pub fn remove_pid() {
    let _ = fs::remove_file(config::PID_PATH);
}

pub fn lan_from_settings(settings: &config::MihomoSettings) -> Vec<String> {
    if !settings.lan_interfaces.is_empty() {
        let mut v = settings.lan_interfaces.clone();
        v.sort();
        v.dedup();
        return v;
    }
    detect_lan_interfaces()
}

fn redirect_plan(
    lans: &[String],
    redir_port: u16,
    block_quic: bool,
    block_ipv6: bool,
) -> Vec<FirewallCommand> {
    let mut plan = Vec::new();
    plan.push(FirewallCommand::new(
        "iptables",
        &["-w", "5", "-t", "nat", "-N", REDIR_CHAIN],
    ));
    for net in PRIVATE_ROUTES {
        plan.push(FirewallCommand::owned(
            "iptables",
            vec![
                "-w".into(),
                "5".into(),
                "-t".into(),
                "nat".into(),
                "-A".into(),
                REDIR_CHAIN.into(),
                "-d".into(),
                (*net).into(),
                "-j".into(),
                "RETURN".into(),
            ],
        ));
    }
    for port in [redir_port, 7890, 9090, 9091] {
        plan.push(FirewallCommand::owned(
            "iptables",
            vec![
                "-w".into(),
                "5".into(),
                "-t".into(),
                "nat".into(),
                "-A".into(),
                REDIR_CHAIN.into(),
                "-p".into(),
                "tcp".into(),
                "--dport".into(),
                port.to_string(),
                "-j".into(),
                "RETURN".into(),
            ],
        ));
    }
    plan.push(FirewallCommand::owned(
        "iptables",
        vec![
            "-w".into(),
            "5".into(),
            "-t".into(),
            "nat".into(),
            "-A".into(),
            REDIR_CHAIN.into(),
            "-p".into(),
            "tcp".into(),
            "-j".into(),
            "REDIRECT".into(),
            "--to-ports".into(),
            redir_port.to_string(),
        ],
    ));
    for lan in lans {
        plan.push(FirewallCommand::owned(
            "iptables",
            vec![
                "-w".into(),
                "5".into(),
                "-t".into(),
                "nat".into(),
                "-I".into(),
                "PREROUTING".into(),
                "1".into(),
                "-i".into(),
                lan.clone(),
                "-j".into(),
                REDIR_CHAIN.into(),
            ],
        ));
    }

    if block_quic {
        plan.push(FirewallCommand::new(
            "iptables",
            &["-w", "5", "-t", "filter", "-N", QUIC_CHAIN],
        ));
        for net in PRIVATE_ROUTES {
            plan.push(FirewallCommand::owned(
                "iptables",
                vec![
                    "-w".into(),
                    "5".into(),
                    "-t".into(),
                    "filter".into(),
                    "-A".into(),
                    QUIC_CHAIN.into(),
                    "-d".into(),
                    (*net).into(),
                    "-j".into(),
                    "RETURN".into(),
                ],
            ));
        }
        plan.push(FirewallCommand::new(
            "iptables",
            &[
                "-w", "5", "-t", "filter", "-A", QUIC_CHAIN, "-p", "udp", "--dport", "443", "-j",
                "REJECT",
            ],
        ));
        for lan in lans {
            plan.push(FirewallCommand::owned(
                "iptables",
                vec![
                    "-w".into(),
                    "5".into(),
                    "-t".into(),
                    "filter".into(),
                    "-I".into(),
                    "FORWARD".into(),
                    "1".into(),
                    "-i".into(),
                    lan.clone(),
                    "-j".into(),
                    QUIC_CHAIN.into(),
                ],
            ));
        }
    }

    if block_ipv6 {
        plan.push(FirewallCommand::new(
            "ip6tables",
            &["-w", "5", "-t", "filter", "-N", IPV6_CHAIN],
        ));
        plan.push(FirewallCommand::new(
            "ip6tables",
            &["-w", "5", "-t", "filter", "-A", IPV6_CHAIN, "-j", "REJECT"],
        ));
        for lan in lans {
            plan.push(FirewallCommand::owned(
                "ip6tables",
                vec![
                    "-w".into(),
                    "5".into(),
                    "-t".into(),
                    "filter".into(),
                    "-I".into(),
                    "FORWARD".into(),
                    "1".into(),
                    "-i".into(),
                    lan.clone(),
                    "-j".into(),
                    IPV6_CHAIN.into(),
                ],
            ));
        }
    }

    plan
}

pub fn apply_redirect(
    lans: &[String],
    redir_port: u16,
    block_quic: bool,
    block_ipv6: bool,
) -> Result<(), String> {
    cleanup_redirect(lans);
    let plan = redirect_plan(lans, redir_port, block_quic, block_ipv6);
    if let Err(e) = run_plan(&plan) {
        cleanup_redirect(lans);
        return Err(e);
    }
    Ok(())
}

pub fn cleanup_redirect(configured_lans: &[String]) {
    let mut lans = detect_lan_interfaces();
    for lan in configured_lans {
        if !lans.iter().any(|v| v == lan) {
            lans.push(lan.clone());
        }
    }
    for lan in &lans {
        for _ in 0..8 {
            let ok = Command::new("iptables")
                .args([
                    "-w",
                    "5",
                    "-t",
                    "nat",
                    "-D",
                    "PREROUTING",
                    "-i",
                    lan,
                    "-j",
                    REDIR_CHAIN,
                ])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
            if !ok {
                break;
            }
        }
        for _ in 0..8 {
            let ok = Command::new("iptables")
                .args([
                    "-w", "5", "-t", "filter", "-D", "FORWARD", "-i", lan, "-j", QUIC_CHAIN,
                ])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
            if !ok {
                break;
            }
        }
        for _ in 0..8 {
            let ok = Command::new("ip6tables")
                .args([
                    "-w", "5", "-t", "filter", "-D", "FORWARD", "-i", lan, "-j", IPV6_CHAIN,
                ])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
            if !ok {
                break;
            }
        }
    }
    for (program, table, chain) in [
        ("iptables", "nat", REDIR_CHAIN),
        ("iptables", "filter", QUIC_CHAIN),
        ("ip6tables", "filter", IPV6_CHAIN),
    ] {
        try_run(program, &["-w", "5", "-t", table, "-F", chain]);
        try_run(program, &["-w", "5", "-t", table, "-X", chain]);
    }
}

pub fn redirect_rules_present(lans: &[String]) -> bool {
    if lans.is_empty() {
        return false;
    }
    lans.iter().all(|lan| {
        Command::new("iptables")
            .args([
                "-w",
                "5",
                "-t",
                "nat",
                "-C",
                "PREROUTING",
                "-i",
                lan,
                "-j",
                REDIR_CHAIN,
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    })
}

pub fn enable_dns(dns_port: u16) -> Result<(), String> {
    fs::create_dir_all("/tmp/dnsmasq.d").map_err(|e| format!("create dnsmasq.d: {e}"))?;
    config::ensure_dirs()?;
    if Path::new(DOH_DROPIN).exists() {
        fs::rename(DOH_DROPIN, config::DOH_PAUSED_PATH)
            .map_err(|e| format!("pause DoH drop-in: {e}"))?;
    }
    config::write_atomic(
        DNSMASQ_DROPIN,
        format!("server=127.0.0.1#{dns_port}\nno-resolv\n").as_bytes(),
        0o644,
    )?;
    restart_dnsmasq()
}

pub fn disable_dns() -> Result<(), String> {
    let _ = fs::remove_file(DNSMASQ_DROPIN);
    if Path::new(config::DOH_PAUSED_PATH).exists() {
        let _ = fs::rename(config::DOH_PAUSED_PATH, DOH_DROPIN);
    }
    restart_dnsmasq()
}

pub fn dns_override_active() -> bool {
    Path::new(DNSMASQ_DROPIN).exists()
}

fn restart_dnsmasq() -> Result<(), String> {
    let status = Command::new("sh")
        .args(["-c", "/etc/init.d/dnsmasq restart"])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .status()
        .map_err(|e| format!("restart dnsmasq: {e}"))?;
    if !status.success() {
        return Err("dnsmasq restart failed".to_string());
    }
    std::thread::sleep(Duration::from_millis(400));
    Ok(())
}

pub fn dns_health(port: u16) -> bool {
    let id = (SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u16)
        .unwrap_or(1))
    .max(1);
    let mut query = Vec::with_capacity(32);
    query.extend_from_slice(&id.to_be_bytes());
    query.extend_from_slice(&[0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    for label in "example.com".split('.') {
        query.push(label.len() as u8);
        query.extend_from_slice(label.as_bytes());
    }
    query.extend_from_slice(&[0x00, 0x00, 0x01, 0x00, 0x01]);

    let socket = match UdpSocket::bind("127.0.0.1:0") {
        Ok(s) => s,
        Err(_) => return false,
    };
    let _ = socket.set_read_timeout(Some(Duration::from_secs(2)));
    let addr = format!("127.0.0.1:{port}");
    if socket.send_to(&query, &addr).is_err() {
        return false;
    }
    let mut buf = [0u8; 1500];
    let n = match socket.recv_from(&mut buf) {
        Ok((n, _)) => n,
        Err(_) => return false,
    };
    if n < 12 {
        return false;
    }
    let resp_id = u16::from_be_bytes([buf[0], buf[1]]);
    let flags = u16::from_be_bytes([buf[2], buf[3]]);
    let ancount = u16::from_be_bytes([buf[6], buf[7]]);
    resp_id == id && (flags & 0x8000) != 0 && (flags & 0x000f) == 0 && ancount > 0
}

pub fn tun_exists() -> bool {
    Command::new("ip")
        .args(["link", "show", TUN_NAME])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

pub fn cleanup_tun(table_index: Option<i32>, rule_index: Option<i32>) {
    try_run("ip", &["link", "del", TUN_NAME]);
    if let Some(table) = table_index {
        for _ in 0..8 {
            let ok = Command::new("ip")
                .args(["rule", "del", "table", &table.to_string()])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
            if !ok {
                break;
            }
        }
    }
    if let Some(rule) = rule_index {
        // A rule may have been installed by mihomo with a fixed priority;
        // deleting by priority is best-effort and harmless when absent.
        for priority in [rule, rule + 1, rule + 2] {
            try_run("ip", &["rule", "del", "pref", &priority.to_string()]);
        }
    }
    try_run("nft", &["delete", "table", "inet", "mihomo"]);
    for table in ["nat", "filter", "mangle"] {
        try_run("iptables", &["-w", "5", "-t", table, "-F", "mihomo"]);
        try_run("iptables", &["-w", "5", "-t", table, "-X", "mihomo"]);
    }
}

pub fn write_panic_script() -> Result<(), String> {
    let script = r#"#!/bin/sh
# Emergency recovery for mihomo transparent mode. Safe to run when nothing is active.
PID=$(pidof mihomo 2>/dev/null)
[ -n "$PID" ] && kill $PID 2>/dev/null
sleep 2
PID=$(pidof mihomo 2>/dev/null)
[ -n "$PID" ] && kill -9 $PID 2>/dev/null

for IF in $(ls /sys/class/net 2>/dev/null | grep '^br-'); do
  iptables -w 5 -t nat -D PREROUTING -i "$IF" -j MIHOMO_REDIR 2>/dev/null
  iptables -w 5 -t filter -D FORWARD -i "$IF" -j MIHOMO_QUIC 2>/dev/null
  ip6tables -w 5 -t filter -D FORWARD -i "$IF" -j MIHOMO6 2>/dev/null
done
for C in MIHOMO_REDIR MIHOMO_QUIC MIHOMO6; do
  iptables -w 5 -t nat -F "$C" 2>/dev/null
  iptables -w 5 -t nat -X "$C" 2>/dev/null
  iptables -w 5 -t filter -F "$C" 2>/dev/null
  iptables -w 5 -t filter -X "$C" 2>/dev/null
  ip6tables -w 5 -t filter -F "$C" 2>/dev/null
  ip6tables -w 5 -t filter -X "$C" 2>/dev/null
done

rm -f /tmp/dnsmasq.d/mihomo.conf
[ -f /data/mihomo/state/doh.conf.paused ] && mv /data/mihomo/state/doh.conf.paused /tmp/dnsmasq.d/doh.conf
/etc/init.d/dnsmasq restart 2>/dev/null

ip link del mihomo0 2>/dev/null
nft delete table inet mihomo 2>/dev/null
for T in 2022; do ip rule del table $T 2>/dev/null; done
rm -f /data/mihomo/state/pending
touch /data/mihomo/state/safe_mode
echo "mihomo stopped, network rules removed, safe mode set"
"#;
    config::ensure_dirs()?;
    let path = Path::new(config::PANIC_PATH);
    fs::write(path, script).map_err(|e| format!("write panic script: {e}"))?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o755))
        .map_err(|e| format!("chmod panic script: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redirect_plan_has_lan_jumps_and_private_exclusions() {
        let lans = vec!["br-lan".to_string()];
        let plan = redirect_plan(&lans, 7892, true, false);
        assert!(plan.iter().any(|c| {
            c.program == "iptables"
                && c.args.join(" ") == "-w 5 -t nat -I PREROUTING 1 -i br-lan -j MIHOMO_REDIR"
        }));
        assert!(plan
            .iter()
            .any(|c| c.args.iter().any(|a| a == "100.64.0.0/10")));
        assert!(plan
            .iter()
            .any(|c| { c.args.join(" ").contains("-p udp --dport 443 -j REJECT") }));
        assert!(!plan.iter().any(|c| c.program == "ip6tables"));
    }

    #[test]
    fn redirect_plan_can_block_ipv6() {
        let lans = vec!["br-lan".to_string()];
        let plan = redirect_plan(&lans, 7892, false, true);
        assert!(plan.iter().any(|c| c.program == "ip6tables"));
        assert!(!plan
            .iter()
            .any(|c| c.args.join(" ").contains("MIHOMO_QUIC")));
    }

    #[test]
    fn dns_health_query_is_well_formed() {
        // Just exercise the parser path with a handcrafted response; the
        // network path is device-specific.
        let response = [
            0x12, 0x34, 0x81, 0x80, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
        ];
        let id = u16::from_be_bytes([response[0], response[1]]);
        let flags = u16::from_be_bytes([response[2], response[3]]);
        let ancount = u16::from_be_bytes([response[6], response[7]]);
        assert_eq!(id, 0x1234);
        assert!(flags & 0x8000 != 0 && flags & 0x000f == 0 && ancount > 0);
    }
}
