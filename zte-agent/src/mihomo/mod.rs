pub mod binary;
pub mod config;
pub mod controller;
pub mod handlers;
pub mod network;

use std::fs::{self, OpenOptions};
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use self::config::{EffectiveConfig, MihomoSettings, Mode};
use self::network::Capabilities;

enum ProcessHandle {
    Spawned(Child),
    Adopted(u32),
}

impl ProcessHandle {
    fn pid(&self) -> u32 {
        match self {
            ProcessHandle::Spawned(child) => child.id(),
            ProcessHandle::Adopted(pid) => *pid,
        }
    }

    fn is_alive(&mut self) -> bool {
        match self {
            ProcessHandle::Spawned(child) => match child.try_wait() {
                Ok(Some(_)) => false,
                Ok(None) => true,
                Err(_) => false,
            },
            ProcessHandle::Adopted(pid) => network::pid_alive(*pid),
        }
    }

    fn terminate(&mut self) {
        if !self.is_alive() {
            return;
        }
        let pid = self.pid();
        unsafe {
            libc::kill(pid as i32, libc::SIGTERM);
        }
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if !self.is_alive() {
                return;
            }
            if Instant::now() >= deadline {
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }
        unsafe {
            libc::kill(pid as i32, libc::SIGKILL);
        }
        if let ProcessHandle::Spawned(child) = self {
            let _ = child.wait();
        }
    }
}

struct Inner {
    settings: MihomoSettings,
    proc: Option<ProcessHandle>,
    effective_mode: Option<Mode>,
    last_effective: Option<EffectiveConfig>,
    started_at: Option<i64>,
    last_error: Option<String>,
    capabilities: Option<Capabilities>,
    config_valid: bool,
    dns_active: bool,
    redirect_active: bool,
    crash_count: u32,
    next_retry_at: Option<i64>,
    health_failures: u32,
}

pub struct MihomoManager {
    inner: Mutex<Inner>,
    op: Mutex<()>,
    supervisor_started: AtomicBool,
}

impl MihomoManager {
    pub fn new() -> Self {
        let _ = config::ensure_dirs();
        let mut settings = config::load();
        if Path::new(config::PENDING_PATH).exists() {
            // The agent died while applying transparent mode. Never retry that
            // state automatically; force direct networking and safe mode.
            settings.safe_mode = true;
            settings.autostart = false;
            settings.transparent = false;
            settings.desired_running = false;
            settings.last_error =
                Some("agent stopped during transparent-mode setup; safe mode enabled".to_string());
            let _ = config::save(&settings);
            let _ = fs::write(config::SAFE_MODE_PATH, b"1\n");
            let _ = fs::remove_file(config::PENDING_PATH);
        } else if Path::new(config::SAFE_MODE_PATH).exists() {
            settings.safe_mode = true;
            settings.autostart = false;
            settings.transparent = false;
            settings.desired_running = false;
            let _ = config::save(&settings);
        } else if settings.safe_mode {
            settings.desired_running = false;
            let _ = fs::write(config::SAFE_MODE_PATH, b"1\n");
            let _ = config::save(&settings);
        }
        if !Path::new(config::CONFIG_PATH).exists() {
            let _ = config::write_user_config(&config::default_config());
        }
        let _ = network::write_panic_script();
        let config_valid = false;
        let initial_error = settings.last_error.clone();
        Self {
            inner: Mutex::new(Inner {
                settings,
                proc: None,
                effective_mode: None,
                last_effective: None,
                started_at: None,
                last_error: initial_error,
                capabilities: None,
                config_valid,
                dns_active: false,
                redirect_active: false,
                crash_count: 0,
                next_retry_at: None,
                health_failures: 0,
            }),
            op: Mutex::new(()),
            supervisor_started: AtomicBool::new(false),
        }
    }

    fn lock_op(&self) -> Result<std::sync::MutexGuard<'_, ()>, String> {
        self.op
            .lock()
            .map_err(|_| "mihomo operation lock poisoned".to_string())
    }

    fn settings_snapshot(&self) -> MihomoSettings {
        self.inner
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .settings
            .clone()
    }

    fn set_error(&self, message: impl Into<String>) {
        let message = message.into();
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        inner.last_error = Some(message.clone());
        inner.settings.last_error = Some(message);
        let _ = config::save(&inner.settings);
    }

    fn clear_safe_mode_marker(&self) {
        let _ = fs::remove_file(config::SAFE_MODE_PATH);
    }

    fn enter_safe_mode(&self, message: impl Into<String>) {
        let message = message.into();
        {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            inner.settings.safe_mode = true;
            inner.settings.autostart = false;
            inner.settings.desired_running = false;
            inner.settings.last_error = Some(message.clone());
            inner.last_error = Some(message.clone());
            let _ = config::save(&inner.settings);
        }
        let _ = fs::write(config::SAFE_MODE_PATH, b"1\n");
        eprintln!("[mihomo] safe mode: {message}");
    }

    fn settings_json_snapshot(&self) -> Value {
        settings_to_json(&self.settings_snapshot())
    }

    pub fn status(&self) -> Value {
        let (settings, pid, mode, started_at, last_error, config_valid, dns_active, effective) = {
            let inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            let pid = inner.proc.as_ref().map(|p| p.pid());
            // A process that died between supervisor ticks is reported dead
            // immediately; the supervisor will reap it shortly.
            let alive_pid = pid.filter(|pid| network::pid_alive(*pid));
            (
                inner.settings.clone(),
                alive_pid,
                inner.effective_mode,
                inner.started_at,
                inner.last_error.clone(),
                inner.config_valid,
                inner.dns_active,
                inner.last_effective.clone(),
            )
        };
        let installed = binary::installed();
        let controller_reachable = pid
            .map(|_| {
                controller::version(settings.controller_port, &settings.controller_secret).is_ok()
            })
            .unwrap_or(false);
        let memory_kb = pid.and_then(process_rss_kb);
        let modified_at = fs::metadata(config::CONFIG_PATH)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64);
        let lans = network::lan_from_settings(&settings);
        let mode_name = mode.map(Mode::as_str);
        json!({
            "installed": installed,
            "version": settings.installed_version,
            "binary_sha256": settings.binary_sha256,
            "binary_size": settings.binary_size,
            "installed_at": settings.installed_at,
            "install_source": settings.install_source,
            "running": pid.is_some(),
            "pid": pid,
            "uptime_secs": started_at.map(|t| config::unix_now().saturating_sub(t)).unwrap_or(0),
            "desired_running": settings.desired_running,
            "autostart": settings.autostart,
            "transparent": settings.transparent,
            "requested_mode": settings.transparent_mode,
            "effective_mode": mode_name,
            "safe_mode": settings.safe_mode || Path::new(config::SAFE_MODE_PATH).exists(),
            "config": {
                "path": config::CONFIG_PATH,
                "runtime_path": config::RUNTIME_PATH,
                "valid": config_valid,
                "modified_at": modified_at,
            },
            "network": {
                "lan_interfaces": lans,
                "dns_override": dns_active || network::dns_override_active(),
                "quic_blocked": settings.block_quic && mode == Some(Mode::Redirect),
                "ipv6_blocked": settings.block_ipv6 && mode == Some(Mode::Redirect),
            },
            "effective": effective.map(|e| json!({
                "mixed_port": e.mixed_port,
                "redir_port": e.redir_port,
                "dns_port": e.dns_port,
            })).unwrap_or(Value::Null),
            "controller": {
                "address": format!("127.0.0.1:{}", settings.controller_port),
                "reachable": controller_reachable,
            },
            "memory_kb": memory_kb,
            "last_error": last_error,
        })
    }

    pub fn capabilities(&self, force: bool) -> Value {
        if !force {
            let inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(caps) = &inner.capabilities {
                return serde_json::to_value(caps).unwrap_or_else(|_| json!({}));
            }
        }
        let caps = network::probe();
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        inner.capabilities = Some(caps.clone());
        serde_json::to_value(&caps).unwrap_or_else(|_| json!({}))
    }

    pub fn config_get(&self) -> Result<Value, String> {
        let yaml = config::read_user_config().unwrap_or_else(config::default_config);
        let settings = self.settings_snapshot();
        let mode = if settings.transparent {
            Mode::parse(&settings.transparent_mode).unwrap_or(Mode::Direct)
        } else {
            Mode::Direct
        };
        let effective = config::build_runtime(&yaml, &settings, mode)
            .ok()
            .map(|(_, e)| e);
        let modified_at = fs::metadata(config::CONFIG_PATH)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64);
        let valid = self
            .inner
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .config_valid;
        Ok(json!({
            "yaml": yaml,
            "path": config::CONFIG_PATH,
            "runtime_path": config::RUNTIME_PATH,
            "size": yaml.len(),
            "modified_at": modified_at,
            "valid": valid,
            "effective": effective.map(|e| json!({
                "mixed_port": e.mixed_port,
                "redir_port": e.redir_port,
                "dns_port": e.dns_port,
            })).unwrap_or(Value::Null),
        }))
    }

    fn requested_mode(&self, settings: &MihomoSettings, probe_tun: bool) -> Mode {
        if !settings.transparent {
            return Mode::Direct;
        }
        match settings.transparent_mode.as_str() {
            "tun" => Mode::Tun,
            "redirect" => Mode::Redirect,
            _ if probe_tun => Mode::Tun,
            _ => Mode::Redirect,
        }
    }

    pub fn config_validate(&self, yaml: &str) -> Result<Value, String> {
        if !binary::installed() {
            return Err("mihomo is not installed".to_string());
        }
        let settings = self.settings_snapshot();
        let mode = if settings.transparent {
            self.requested_mode(&settings, network::probe().tun.available)
        } else {
            Mode::Direct
        };
        config::check_ports(yaml, &settings, mode)?;
        let (runtime, effective) =
            config::build_runtime(yaml, &settings, mode).map_err(|e| format!("YAML: {e}"))?;
        let temp = format!("{}/.validate-{}.yaml", config::BASE_DIR, std::process::id());
        config::write_atomic(&temp, runtime.as_bytes(), 0o600)?;
        let result = binary::test_config(&temp);
        let _ = fs::remove_file(&temp);
        result?;
        Ok(json!({
            "valid": true,
            "mode": mode.as_str(),
            "effective": {
                "mixed_port": effective.mixed_port,
                "redir_port": effective.redir_port,
                "dns_port": effective.dns_port,
            }
        }))
    }

    pub fn config_save(&self, yaml: &str) -> Result<Value, String> {
        let _op = self.lock_op()?;
        if yaml.len() > config::MAX_CONFIG_BYTES {
            return Err(format!(
                "config is too large (max {} bytes)",
                config::MAX_CONFIG_BYTES
            ));
        }
        if !binary::installed() {
            return Err("mihomo is not installed".to_string());
        }
        let settings = self.settings_snapshot();
        let mode = if settings.transparent {
            self.requested_mode(&settings, network::probe().tun.available)
        } else {
            Mode::Direct
        };
        config::check_ports(yaml, &settings, mode)?;
        let (runtime, _) = config::build_runtime(yaml, &settings, mode)?;
        let temp = format!("{}/.validate-{}.yaml", config::BASE_DIR, std::process::id());
        config::write_atomic(&temp, runtime.as_bytes(), 0o600)?;
        let result = binary::test_config(&temp);
        let _ = fs::remove_file(&temp);
        result?;
        config::write_user_config(yaml)?;
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        inner.config_valid = true;
        inner.last_error = None;
        inner.settings.last_error = None;
        let running = inner.proc.is_some();
        let _ = config::save(&inner.settings);
        Ok(json!({
            "valid": true,
            "needs_restart": running,
            "mode": mode.as_str(),
        }))
    }

    pub fn update_settings(&self, patch: &Value) -> Result<Value, String> {
        let _op = self.lock_op()?;
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let mut changed_network = false;
        if let Some(v) = patch.get("autostart").and_then(|v| v.as_bool()) {
            inner.settings.autostart = v;
        }
        if let Some(v) = patch.get("transparent").and_then(|v| v.as_bool()) {
            if inner.settings.transparent != v {
                changed_network = true;
            }
            inner.settings.transparent = v;
        }
        if let Some(v) = patch.get("transparent_mode").and_then(|v| v.as_str()) {
            if !config::mode_valid(v) {
                return Err("transparent_mode must be auto, tun or redirect".to_string());
            }
            if inner.settings.transparent_mode != v {
                changed_network = true;
            }
            inner.settings.transparent_mode = v.to_string();
        }
        if let Some(v) = patch.get("block_quic").and_then(|v| v.as_bool()) {
            if inner.settings.block_quic != v {
                changed_network = true;
            }
            inner.settings.block_quic = v;
        }
        if let Some(v) = patch.get("block_ipv6").and_then(|v| v.as_bool()) {
            if inner.settings.block_ipv6 != v {
                changed_network = true;
            }
            inner.settings.block_ipv6 = v;
        }
        if let Some(v) = patch.get("lan_interfaces") {
            let arr = v
                .as_array()
                .ok_or_else(|| "lan_interfaces must be an array".to_string())?;
            let mut names = Vec::new();
            for item in arr {
                let name = item
                    .as_str()
                    .ok_or_else(|| "lan_interfaces must contain strings".to_string())?;
                if name.is_empty()
                    || name.len() > 32
                    || !name
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
                {
                    return Err(format!("invalid interface name: {name}"));
                }
                names.push(name.to_string());
            }
            inner.settings.lan_interfaces = names;
            changed_network = true;
        }
        let running = inner.proc.is_some();
        let needs_restart = running && changed_network;
        internal_save(&inner.settings)?;
        Ok(json!({
            "settings": settings_to_json(&inner.settings),
            "needs_restart": needs_restart,
        }))
    }

    pub fn clear_safe_mode(&self) -> Result<Value, String> {
        let _op = self.lock_op()?;
        {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            inner.settings.safe_mode = false;
            inner.settings.last_error = None;
            inner.last_error = None;
            let _ = config::save(&inner.settings);
        }
        self.clear_safe_mode_marker();
        Ok(json!({"safe_mode": false}))
    }

    pub fn logs(&self, lines: usize) -> Value {
        json!({"lines": binary::logs_tail(lines), "path": config::LOG_PATH})
    }

    pub fn clear_logs(&self) -> Result<Value, String> {
        binary::clear_logs()?;
        Ok(json!({"cleared": true}))
    }

    pub fn record_install(&self, installed: binary::InstalledBinary) -> Result<Value, String> {
        let _op = self.lock_op()?;
        let running = {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            inner.settings.installed_version = Some(installed.version.clone());
            inner.settings.binary_sha256 = Some(installed.sha256.clone());
            inner.settings.binary_size = Some(installed.size);
            inner.settings.installed_at = Some(config::unix_now());
            inner.settings.install_source = Some(installed.source.clone());
            inner.settings.last_error = None;
            inner.last_error = None;
            internal_save(&inner.settings)?;
            inner.proc.is_some()
        };
        Ok(json!({
            "version": installed.version,
            "sha256": installed.sha256,
            "size": installed.size,
            "needs_restart": running,
        }))
    }

    pub fn install_download(&self, version: &str, sha256: &str) -> Result<Value, String> {
        let installed = binary::download_and_install(version, sha256)?;
        self.record_install(installed)
    }

    pub fn start(&self) -> Result<Value, String> {
        let _op = self.lock_op()?;
        let settings = self.settings_snapshot();
        if settings.safe_mode || Path::new(config::SAFE_MODE_PATH).exists() {
            return Err("safe mode is active; clear it before starting".to_string());
        }
        if !binary::installed() {
            return Err("mihomo is not installed".to_string());
        }
        let already_running = {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            let alive = match inner.proc.as_mut() {
                Some(proc) => proc.is_alive(),
                None => false,
            };
            if !alive && inner.proc.is_some() {
                inner.proc = None;
                let _ = network::remove_pid();
            }
            alive
        };
        if already_running {
            return Ok(self.status());
        }
        self.start_locked_with_fallback(&settings)?;
        Ok(self.status())
    }

    pub fn stop(&self) -> Result<Value, String> {
        let _op = self.lock_op()?;
        self.stop_locked()?;
        Ok(self.status())
    }

    pub fn restart(&self) -> Result<Value, String> {
        let _op = self.lock_op()?;
        let settings = self.settings_snapshot();
        self.stop_locked()?;
        self.start_locked_with_fallback(&settings)?;
        Ok(self.status())
    }

    pub fn panic(&self) -> Result<Value, String> {
        let _op = self.lock_op()?;
        let stop_result = self.stop_locked();
        {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            inner.settings.autostart = false;
            inner.settings.transparent = false;
            inner.settings.desired_running = false;
            inner.settings.safe_mode = true;
            inner.settings.last_error = None;
            inner.last_error = None;
            let _ = config::save(&inner.settings);
        }
        let _ = fs::write(config::SAFE_MODE_PATH, b"1\n");
        let _ = fs::remove_file(config::PENDING_PATH);
        stop_result?;
        Ok(self.status())
    }

    fn start_locked_with_fallback(&self, settings: &MihomoSettings) -> Result<(), String> {
        let caps = network::probe();
        let requested = self.requested_mode(settings, caps.tun.available);
        if !settings.transparent {
            return self.start_mode(settings, Mode::Direct, &caps);
        }
        if settings.transparent_mode == "auto" && requested == Mode::Tun {
            match self.start_mode(settings, Mode::Tun, &caps) {
                Ok(()) => return Ok(()),
                Err(tun_error) => {
                    eprintln!("[mihomo] TUN start failed, falling back to REDIRECT: {tun_error}");
                    self.stop_process_only();
                    self.cleanup_network(Mode::Tun, None, settings);
                    match self.start_mode(settings, Mode::Redirect, &caps) {
                        Ok(()) => return Ok(()),
                        Err(redirect_error) => {
                            self.enter_safe_mode(format!(
                                "transparent start failed (TUN: {tun_error}; REDIRECT: {redirect_error})"
                            ));
                            return Err(redirect_error);
                        }
                    }
                }
            }
        }
        match self.start_mode(settings, requested, &caps) {
            Ok(()) => Ok(()),
            Err(e) => {
                if settings.transparent {
                    self.enter_safe_mode(format!("transparent start failed: {e}"));
                }
                Err(e)
            }
        }
    }

    fn start_mode(
        &self,
        settings: &MihomoSettings,
        mode: Mode,
        caps: &Capabilities,
    ) -> Result<(), String> {
        let user = config::read_user_config().unwrap_or_else(config::default_config);
        config::check_ports(&user, settings, mode)?;
        let (runtime, effective) = config::build_runtime(&user, settings, mode)?;
        config::ensure_dirs()?;
        config::write_atomic(config::RUNTIME_PATH, runtime.as_bytes(), 0o600)?;
        binary::test_config(config::RUNTIME_PATH)?;

        if mode != Mode::Direct {
            config::write_atomic(config::PENDING_PATH, b"starting\n", 0o600)?;
        }

        let child = match self.spawn_process(settings, caps) {
            Ok(child) => child,
            Err(e) => {
                let _ = fs::remove_file(config::PENDING_PATH);
                self.set_error(&e);
                return Err(e);
            }
        };
        {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            inner.proc = Some(child);
            inner.started_at = Some(config::unix_now());
            inner.effective_mode = Some(mode);
            inner.last_effective = Some(effective.clone());
            inner.health_failures = 0;
        }

        if let Err(e) = self.wait_for_controller(settings) {
            self.stop_process_only();
            self.cleanup_network(mode, Some(effective), settings);
            let _ = fs::remove_file(config::PENDING_PATH);
            self.set_error(&e);
            return Err(e);
        }

        if mode == Mode::Redirect {
            let lans = network::lan_from_settings(settings);
            if let Err(e) = network::apply_redirect(
                &lans,
                effective.redir_port,
                settings.block_quic,
                settings.block_ipv6,
            ) {
                self.stop_process_only();
                self.cleanup_network(mode, Some(effective), settings);
                let _ = fs::remove_file(config::PENDING_PATH);
                self.set_error(&e);
                return Err(e);
            }
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            inner.redirect_active = true;
        }

        if mode != Mode::Direct {
            if let Err(e) = network::enable_dns(effective.dns_port) {
                self.stop_process_only();
                self.cleanup_network(mode, Some(effective), settings);
                let _ = fs::remove_file(config::PENDING_PATH);
                self.set_error(&e);
                return Err(e);
            }
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            inner.dns_active = true;
        }

        if let Err(e) = self.wait_for_health(settings, mode, &effective) {
            self.stop_process_only();
            self.cleanup_network(mode, Some(effective), settings);
            let _ = fs::remove_file(config::PENDING_PATH);
            self.set_error(&e);
            return Err(e);
        }

        let _ = fs::remove_file(config::PENDING_PATH);
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        inner.config_valid = true;
        inner.effective_mode = Some(mode);
        inner.last_effective = Some(effective);
        inner.started_at = Some(config::unix_now());
        inner.last_error = None;
        inner.settings.last_error = None;
        inner.settings.desired_running = true;
        inner.settings.last_started_at = inner.started_at;
        inner.settings.last_effective_mode = Some(mode.as_str().to_string());
        inner.crash_count = 0;
        inner.next_retry_at = None;
        inner.health_failures = 0;
        internal_save(&inner.settings)?;
        Ok(())
    }

    fn spawn_process(
        &self,
        settings: &MihomoSettings,
        caps: &Capabilities,
    ) -> Result<ProcessHandle, String> {
        binary::rotate_log();
        config::ensure_dirs()?;
        let log = OpenOptions::new()
            .create(true)
            .append(true)
            .open(config::LOG_PATH)
            .map_err(|e| format!("open log: {e}"))?;
        let _ = fs::set_permissions(config::LOG_PATH, fs::Permissions::from_mode(0o640));
        let err_log = log.try_clone().map_err(|e| format!("clone log: {e}"))?;
        let mut cmd = Command::new(config::BIN_PATH);
        cmd.args([
            "-d",
            config::BASE_DIR,
            "-f",
            config::RUNTIME_PATH,
            "-ext-ctl",
            &format!("127.0.0.1:{}", settings.controller_port),
            "-secret",
            &settings.controller_secret,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(err_log));
        if !caps.nftables.available {
            cmd.env("DISABLE_NFTABLES", "true");
        }
        let child = cmd.spawn().map_err(|e| format!("spawn mihomo: {e}"))?;
        let pid = child.id();
        network::write_pid(pid)?;
        Ok(ProcessHandle::Spawned(child))
    }

    fn wait_for_controller(&self, settings: &MihomoSettings) -> Result<(), String> {
        let deadline = Instant::now() + Duration::from_secs(20);
        while Instant::now() < deadline {
            if controller::version(settings.controller_port, &settings.controller_secret).is_ok() {
                return Ok(());
            }
            if !self.process_alive() {
                return Err("mihomo exited before the controller became ready".to_string());
            }
            thread::sleep(Duration::from_millis(500));
        }
        Err("mihomo controller did not become ready within 20s".to_string())
    }

    fn wait_for_health(
        &self,
        settings: &MihomoSettings,
        mode: Mode,
        effective: &EffectiveConfig,
    ) -> Result<(), String> {
        let deadline = Instant::now() + Duration::from_secs(12);
        let mut last_error = String::new();
        while Instant::now() < deadline {
            match self.health(settings, mode, effective) {
                Ok(()) => return Ok(()),
                Err(e) => last_error = e,
            }
            if !self.process_alive() {
                return Err("mihomo exited during the health check".to_string());
            }
            thread::sleep(Duration::from_millis(500));
        }
        Err(format!("health check failed: {last_error}"))
    }

    fn health(
        &self,
        settings: &MihomoSettings,
        mode: Mode,
        effective: &EffectiveConfig,
    ) -> Result<(), String> {
        controller::version(settings.controller_port, &settings.controller_secret)?;
        if mode == Mode::Direct {
            return Ok(());
        }
        if !network::dns_health(effective.dns_port) {
            return Err(format!(
                "DNS on 127.0.0.1:{} is not answering",
                effective.dns_port
            ));
        }
        if !controller::proxy_health(effective.mixed_port) {
            return Err(format!(
                "proxy on 127.0.0.1:{} cannot reach the test URL",
                effective.mixed_port
            ));
        }
        match mode {
            Mode::Tun => {
                if !network::tun_exists() {
                    return Err("mihomo0 TUN interface is missing".to_string());
                }
            }
            Mode::Redirect => {
                let lans = network::lan_from_settings(settings);
                if !network::redirect_rules_present(&lans) {
                    return Err("redirect iptables rules are missing".to_string());
                }
            }
            Mode::Direct => {}
        }
        Ok(())
    }

    fn process_alive(&self) -> bool {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        inner.proc.as_mut().map(|p| p.is_alive()).unwrap_or(false)
    }

    fn stop_process_only(&self) {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(mut proc) = inner.proc.take() {
            proc.terminate();
        }
        network::remove_pid();
        inner.effective_mode = None;
        inner.last_effective = None;
        inner.started_at = None;
        inner.dns_active = false;
        inner.redirect_active = false;
    }

    fn stop_locked(&self) -> Result<(), String> {
        let (mode, effective, settings) = {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            let mode = inner.effective_mode;
            let effective = inner.last_effective.clone();
            let settings = inner.settings.clone();
            if let Some(mut proc) = inner.proc.take() {
                proc.terminate();
            }
            network::remove_pid();
            inner.effective_mode = None;
            inner.last_effective = None;
            inner.started_at = None;
            inner.dns_active = false;
            inner.redirect_active = false;
            inner.settings.desired_running = false;
            inner.settings.last_effective_mode = None;
            let _ = config::save(&inner.settings);
            (mode, effective, settings)
        };
        if let Some(mode) = mode {
            self.cleanup_network(mode, effective, &settings);
        } else {
            // State can be lost across an agent restart while stale rules
            // remain; clean the known markers rather than doing nothing.
            if network::dns_override_active() {
                let _ = network::disable_dns();
            }
            network::cleanup_redirect(&network::lan_from_settings(&settings));
            network::cleanup_tun(None, None);
        }
        Ok(())
    }

    fn cleanup_network(
        &self,
        mode: Mode,
        effective: Option<EffectiveConfig>,
        settings: &MihomoSettings,
    ) {
        let lans = network::lan_from_settings(settings);
        match mode {
            Mode::Direct => {
                // Normally a no-op; clean up if state was lost across an agent
                // restart while transparent rules were still installed.
                if network::dns_override_active() {
                    let _ = network::disable_dns();
                }
                if network::tun_exists() {
                    network::cleanup_tun(None, None);
                }
            }
            Mode::Tun => {
                let _ = network::disable_dns();
                let (table, rule) = effective
                    .map(|e| (e.tun_table_index, e.tun_rule_index))
                    .unwrap_or((None, None));
                network::cleanup_tun(table, rule);
            }
            Mode::Redirect => {
                let _ = network::disable_dns();
                network::cleanup_redirect(&lans);
            }
        }
    }

    /// Drop a saved DoH drop-in when the user disables DoH while mihomo owns
    /// DNS. Otherwise stopping mihomo later would restore a drop-in whose
    /// upstream proxy is no longer running.
    pub fn discard_paused_doh(&self) {
        let _ = fs::remove_file(config::DOH_PAUSED_PATH);
    }

    pub fn dns_override_active(&self) -> bool {
        self.inner
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .dns_active
            || network::dns_override_active()
    }

    pub fn auto_start(self: &Arc<Self>) {
        let mgr = Arc::clone(self);
        let _ = thread::Builder::new()
            .name("mihomo-auto".to_string())
            .spawn(move || {
                mgr.auto_start_inner();
                // Start the supervisor only after the boot decision, so a
                // persisted desired_running flag cannot start mihomo on a
                // reboot where autostart is off.
                mgr.ensure_supervisor();
            });
    }

    fn auto_start_inner(&self) {
        let boot_id = config::current_boot_id();
        let (settings, boot_changed) = {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            let boot_changed = !boot_id.is_empty() && inner.settings.last_boot_id != boot_id;
            if boot_changed {
                inner.settings.last_boot_id = boot_id;
                let _ = config::save(&inner.settings);
            }
            (inner.settings.clone(), boot_changed)
        };

        if settings.safe_mode || Path::new(config::SAFE_MODE_PATH).exists() {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            if inner.settings.desired_running {
                inner.settings.desired_running = false;
                let _ = config::save(&inner.settings);
            }
            return;
        }

        if boot_changed {
            // A reboot resets the current-run intent; only autostart may turn
            // it back on. Otherwise the supervisor would resume a session that
            // was running before the reboot even though autostart is off.
            {
                let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
                if inner.settings.desired_running {
                    inner.settings.desired_running = false;
                    let _ = config::save(&inner.settings);
                }
            }
            if settings.autostart && binary::installed() {
                if self.wait_for_wan(Duration::from_secs(300)) {
                    if let Err(e) = self.start() {
                        self.set_error(format!("autostart failed: {e}"));
                    }
                } else {
                    self.set_error("autostart skipped: WAN was not ready within 5 minutes");
                }
            } else {
                self.stop_orphan();
            }
        } else if settings.desired_running {
            if !self.adopt_existing(&settings) {
                self.stop_orphan();
                if let Err(e) = self.start() {
                    self.set_error(format!("resume failed: {e}"));
                }
            }
        } else {
            self.stop_orphan();
        }
    }

    fn wait_for_wan(&self, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if network::wan_ready() {
                return true;
            }
            thread::sleep(Duration::from_secs(5));
        }
        false
    }

    fn adopt_existing(&self, settings: &MihomoSettings) -> bool {
        let Some(pid) = network::read_pid() else {
            return false;
        };
        if !network::pid_alive(pid) || !cmdline_is_mihomo(pid) {
            network::remove_pid();
            return false;
        }
        if controller::version(settings.controller_port, &settings.controller_secret).is_err() {
            return false;
        }
        let mode = settings
            .last_effective_mode
            .as_deref()
            .and_then(Mode::parse)
            .unwrap_or(Mode::Direct);
        let effective = fs::read_to_string(config::RUNTIME_PATH)
            .ok()
            .and_then(|text| config::effective_from_runtime(&text, settings));
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        inner.proc = Some(ProcessHandle::Adopted(pid));
        inner.effective_mode = Some(mode);
        inner.last_effective = effective;
        inner.started_at = settings.last_started_at;
        inner.dns_active = mode != Mode::Direct && network::dns_override_active();
        inner.redirect_active = mode == Mode::Redirect;
        inner.last_error = None;
        inner.config_valid = true;
        inner.crash_count = 0;
        inner.health_failures = 0;
        eprintln!("[mihomo] adopted existing pid {pid} in {mode:?} mode");
        true
    }

    fn stop_orphan(&self) {
        if let Some(pid) = network::read_pid() {
            if network::pid_alive(pid) && cmdline_is_mihomo(pid) {
                unsafe {
                    libc::kill(pid as i32, libc::SIGTERM);
                }
                for _ in 0..30 {
                    if !network::pid_alive(pid) {
                        break;
                    }
                    thread::sleep(Duration::from_millis(100));
                }
                if network::pid_alive(pid) {
                    unsafe {
                        libc::kill(pid as i32, libc::SIGKILL);
                    }
                }
            }
            network::remove_pid();
        }
        let settings = self.settings_snapshot();
        let mode = settings
            .last_effective_mode
            .as_deref()
            .and_then(Mode::parse)
            .unwrap_or(Mode::Direct);
        if network::dns_override_active() {
            let _ = network::disable_dns();
        }
        if mode == Mode::Redirect || network::dns_override_active() {
            network::cleanup_redirect(&network::lan_from_settings(&settings));
        }
        if mode == Mode::Tun {
            network::cleanup_tun(None, None);
        }
    }

    fn ensure_supervisor(self: &Arc<Self>) {
        if self
            .supervisor_started
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return;
        }
        let mgr = Arc::clone(self);
        let _ = thread::Builder::new()
            .name("mihomo-supervisor".to_string())
            .spawn(move || mgr.supervise());
    }

    fn supervise(&self) {
        let mut last_health = Instant::now();
        loop {
            thread::sleep(Duration::from_secs(5));
            let _op = match self.op.try_lock() {
                Ok(g) => g,
                Err(_) => continue,
            };

            let (had_proc, dead, mode, effective, settings) = {
                let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
                let had_proc = inner.proc.is_some();
                let dead = inner.proc.as_mut().map(|p| !p.is_alive()).unwrap_or(false);
                if dead {
                    inner.proc = None;
                }
                (
                    had_proc,
                    dead,
                    inner.effective_mode,
                    inner.last_effective.clone(),
                    inner.settings.clone(),
                )
            };

            if had_proc && dead {
                network::remove_pid();
                if let Some(mode) = mode {
                    self.cleanup_network(mode, effective, &settings);
                }
                {
                    let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
                    inner.effective_mode = None;
                    inner.last_effective = None;
                    inner.started_at = None;
                    inner.dns_active = false;
                    inner.redirect_active = false;
                    inner.crash_count = inner.crash_count.saturating_add(1);
                    inner.health_failures = 0;
                    if inner.crash_count > 3 {
                        inner.settings.safe_mode = true;
                        inner.settings.autostart = false;
                        inner.settings.desired_running = false;
                        inner.settings.last_error = Some("mihomo crashed repeatedly".to_string());
                        inner.last_error = Some("mihomo crashed repeatedly".to_string());
                        let _ = config::save(&inner.settings);
                        let _ = fs::write(config::SAFE_MODE_PATH, b"1\n");
                        eprintln!("[mihomo] crashed repeatedly, entering safe mode");
                        continue;
                    }
                    let delay = 5u64 * 2u64.saturating_pow(inner.crash_count.saturating_sub(1));
                    inner.next_retry_at = Some(config::unix_now() + delay.min(60) as i64);
                }
                continue;
            }

            let (no_proc, desired, retry_at, crash_count, safe_mode) = {
                let inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
                (
                    inner.proc.is_none(),
                    inner.settings.desired_running,
                    inner.next_retry_at,
                    inner.crash_count,
                    inner.settings.safe_mode || Path::new(config::SAFE_MODE_PATH).exists(),
                )
            };
            if no_proc && desired && !safe_mode {
                let now = config::unix_now();
                let due = retry_at.map(|t| now >= t).unwrap_or(true);
                if due {
                    {
                        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
                        inner.next_retry_at = None;
                    }
                    if let Err(e) = self.start_locked_with_fallback(&settings) {
                        let failures = {
                            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
                            inner.crash_count = crash_count.saturating_add(1);
                            inner.health_failures = 0;
                            inner.next_retry_at = Some(
                                config::unix_now()
                                    + (5u64
                                        * 2u64.saturating_pow(inner.crash_count.saturating_sub(1)))
                                    .min(60) as i64,
                            );
                            inner.crash_count
                        };
                        self.set_error(format!("restart failed ({failures}): {e}"));
                    }
                }
            }

            if last_health.elapsed() >= Duration::from_secs(30) {
                last_health = Instant::now();
                let (running, mode, effective, settings) = {
                    let inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
                    (
                        inner.proc.is_some(),
                        inner.effective_mode,
                        inner.last_effective.clone(),
                        inner.settings.clone(),
                    )
                };
                if running {
                    if let (Some(mode), Some(effective)) = (mode, effective) {
                        if mode != Mode::Direct {
                            if let Err(e) = self.health(&settings, mode, &effective) {
                                let failures = {
                                    let mut inner =
                                        self.inner.lock().unwrap_or_else(|e| e.into_inner());
                                    inner.health_failures = inner.health_failures.saturating_add(1);
                                    inner.health_failures
                                };
                                eprintln!("[mihomo] health check failed ({failures}/3): {e}");
                                if failures >= 3 {
                                    let _ = self.stop_locked();
                                    self.enter_safe_mode(format!(
                                        "transparent health check failed: {e}"
                                    ));
                                }
                            } else {
                                let mut inner =
                                    self.inner.lock().unwrap_or_else(|e| e.into_inner());
                                inner.health_failures = 0;
                            }
                        }
                    }
                }
            }
        }
    }

    pub fn settings_json_for_api(&self) -> Value {
        self.settings_json_snapshot()
    }
}

fn internal_save(settings: &MihomoSettings) -> Result<(), String> {
    config::save(settings)
}

fn settings_to_json(settings: &MihomoSettings) -> Value {
    json!({
        "autostart": settings.autostart,
        "desired_running": settings.desired_running,
        "transparent": settings.transparent,
        "transparent_mode": settings.transparent_mode,
        "block_quic": settings.block_quic,
        "block_ipv6": settings.block_ipv6,
        "controller_port": settings.controller_port,
        "mixed_port": settings.mixed_port,
        "redir_port": settings.redir_port,
        "dns_port": settings.dns_port,
        "lan_interfaces": settings.lan_interfaces,
        "safe_mode": settings.safe_mode,
        "last_error": settings.last_error,
        "installed_version": settings.installed_version,
        "installed_at": settings.installed_at,
        "install_source": settings.install_source,
    })
}

fn process_rss_kb(pid: u32) -> Option<u64> {
    let text = fs::read_to_string(format!("/proc/{pid}/status")).ok()?;
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("VmRSS:") {
            return rest.split_whitespace().next()?.parse().ok();
        }
    }
    None
}

fn cmdline_is_mihomo(pid: u32) -> bool {
    fs::read(format!("/proc/{pid}/cmdline"))
        .map(|bytes| {
            let text = String::from_utf8_lossy(&bytes).replace('\0', " ");
            text.contains(config::BIN_PATH) || text.contains("mihomo")
        })
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_json_never_exposes_controller_secret() {
        let mut settings = MihomoSettings::default();
        settings.controller_secret = "super-secret".to_string();
        let value = settings_to_json(&settings);
        assert!(value.get("controller_secret").is_none());
        assert!(value.get("super-secret").is_none());
    }

    #[test]
    fn requested_mode_defaults_to_direct_when_transparent_is_off() {
        let mgr = MihomoManager::new();
        let settings = MihomoSettings::default();
        assert_eq!(mgr.requested_mode(&settings, true), Mode::Direct);
    }

    #[test]
    fn requested_mode_honours_forced_and_auto_modes() {
        let mgr = MihomoManager::new();
        let mut settings = MihomoSettings::default();
        settings.transparent = true;
        settings.transparent_mode = "tun".to_string();
        assert_eq!(mgr.requested_mode(&settings, false), Mode::Tun);
        settings.transparent_mode = "redirect".to_string();
        assert_eq!(mgr.requested_mode(&settings, true), Mode::Redirect);
        settings.transparent_mode = "auto".to_string();
        assert_eq!(mgr.requested_mode(&settings, true), Mode::Tun);
        assert_eq!(mgr.requested_mode(&settings, false), Mode::Redirect);
    }
}
