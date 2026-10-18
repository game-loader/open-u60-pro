use serde_json::{json, Value};

/// Build the compact proxy-group payload used by the Web UI. Only groups with
/// an `all` list (selectors, url-test, fallback, etc.) are included; plain
/// proxies have no `all` field. Manual switching is offered only for groups
/// whose type is `Selector`; other group types are displayed read-only.
pub fn build_proxy_groups(value: &Value) -> Value {
    let mut groups = Vec::new();
    if let Some(proxies) = value["proxies"].as_object() {
        for (name, info) in proxies {
            let Some(all) = info["all"].as_array() else {
                continue;
            };
            let all: Vec<String> = all
                .iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect();
            if all.is_empty() {
                continue;
            }
            let kind = info["type"].as_str().unwrap_or("").to_string();
            let selectable = kind.eq_ignore_ascii_case("selector");
            groups.push(json!({
                "name": name,
                "type": kind,
                "now": info["now"],
                "all": all,
                "selectable": selectable,
            }));
        }
    }
    groups.sort_by(|a, b| {
        a["name"]
            .as_str()
            .unwrap_or("")
            .cmp(b["name"].as_str().unwrap_or(""))
    });
    json!({"groups": groups, "count": groups.len()})
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_groups_with_an_all_list_and_marks_selectors() {
        let value = json!({
            "proxies": {
                "PROXY": {
                    "type": "Selector",
                    "now": "node-a",
                    "all": ["node-a", "node-b"]
                },
                "AUTO": {
                    "type": "URLTest",
                    "now": "node-b",
                    "all": ["node-a", "node-b"]
                },
                "node-a": {
                    "type": "Shadowsocks",
                    "history": []
                },
                "EMPTY": {
                    "type": "Selector",
                    "now": null,
                    "all": []
                }
            }
        });
        let out = build_proxy_groups(&value);
        assert_eq!(out["count"].as_u64(), Some(2));
        let groups = out["groups"].as_array().unwrap();
        assert_eq!(groups[0]["name"].as_str(), Some("AUTO"));
        assert_eq!(groups[0]["selectable"].as_bool(), Some(false));
        assert_eq!(groups[1]["name"].as_str(), Some("PROXY"));
        assert_eq!(groups[1]["selectable"].as_bool(), Some(true));
        assert_eq!(groups[1]["now"].as_str(), Some("node-a"));
    }

    #[test]
    fn handles_missing_or_malformed_proxies() {
        assert_eq!(build_proxy_groups(&json!({}))["count"].as_u64(), Some(0));
        assert_eq!(
            build_proxy_groups(&json!({"proxies": []}))["count"].as_u64(),
            Some(0)
        );
    }
}
