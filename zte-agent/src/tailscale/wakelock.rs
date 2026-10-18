use serde_json::json;

/// The firmware's sleep daemon requires a named lock; passing `{}` is
/// accepted by `ubus` but the daemon rejects the request. Keep this name
/// stable so create and destroy refer to the same lock.
pub const LOCK_NAME: &str = "tailscale";

pub fn params() -> String {
    json!({"lockName": LOCK_NAME}).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn params_include_the_firmware_lock_name() {
        let value: Value = serde_json::from_str(&params()).unwrap();
        assert_eq!(value["lockName"].as_str(), Some("tailscale"));
        assert_ne!(params(), "{}");
    }
}
