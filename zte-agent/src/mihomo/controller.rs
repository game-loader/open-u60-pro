use std::time::Duration;

use serde_json::Value;

fn agent(timeout: Duration) -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(timeout))
        .build()
        .into()
}

pub fn get_json(port: u16, secret: &str, path: &str, timeout: Duration) -> Result<Value, String> {
    let url = format!("http://127.0.0.1:{port}{path}");
    let mut response = agent(timeout)
        .get(&url)
        .header("Authorization", &format!("Bearer {secret}"))
        .call()
        .map_err(|e| format!("GET {path}: {e}"))?;
    let body = response
        .body_mut()
        .read_to_vec()
        .map_err(|e| format!("read {path}: {e}"))?;
    serde_json::from_slice(&body).map_err(|e| format!("parse {path}: {e}"))
}

pub fn version(port: u16, secret: &str) -> Result<String, String> {
    let value = get_json(port, secret, "/version", Duration::from_secs(3))?;
    if let Some(v) = value["version"].as_str() {
        return Ok(v.to_string());
    }
    if let Some(v) = value["meta"].as_bool() {
        return Ok(format!("meta:{v}"));
    }
    Err("controller /version did not include a version".to_string())
}

/// Ask mihomo to fetch a tiny URL through its mixed proxy. Two endpoints are
/// tried because either can be unreachable from a given network even when the
/// proxy itself is healthy.
pub fn proxy_health(port: u16) -> bool {
    let proxy = match ureq::Proxy::new(&format!("http://127.0.0.1:{port}")) {
        Ok(p) => p,
        Err(_) => return false,
    };
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(5)))
        .proxy(Some(proxy))
        .build()
        .into();
    for url in [
        "http://www.gstatic.com/generate_204",
        "http://cp.cloudflare.com/generate_204",
    ] {
        match agent.get(url).call() {
            Ok(response) => {
                let status = response.status().as_u16();
                if (200..400).contains(&status) {
                    return true;
                }
            }
            Err(_) => continue,
        }
    }
    false
}
