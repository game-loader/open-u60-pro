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

/// The controller expects a single URL path segment for a group name, which
/// may contain spaces, slashes or non-ASCII characters from the YAML.
pub fn encode_path_segment(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            out.push(*byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

pub fn put_json(
    port: u16,
    secret: &str,
    path: &str,
    body: &Value,
    timeout: Duration,
) -> Result<Value, String> {
    let url = format!("http://127.0.0.1:{port}{path}");
    let mut response = agent(timeout)
        .put(&url)
        .header("Authorization", &format!("Bearer {secret}"))
        .header("Content-Type", "application/json")
        .send(body.to_string().as_bytes())
        .map_err(|e| format!("PUT {path}: {e}"))?;
    let status = response.status().as_u16();
    if !(200..300).contains(&status) {
        return Err(format!("PUT {path}: HTTP {status}"));
    }
    let bytes = response
        .body_mut()
        .read_to_vec()
        .map_err(|e| format!("read {path}: {e}"))?;
    if bytes.is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_slice(&bytes).map_err(|e| format!("parse {path}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::encode_path_segment;

    #[test]
    fn encodes_group_names_as_a_single_path_segment() {
        assert_eq!(encode_path_segment("PROXY"), "PROXY");
        assert_eq!(encode_path_segment("my group"), "my%20group");
        assert_eq!(encode_path_segment("a/b"), "a%2Fb");
        assert_eq!(encode_path_segment("代理"), "%E4%BB%A3%E7%90%86");
    }
}
