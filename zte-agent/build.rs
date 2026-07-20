//! 构建脚本：确保 web-dist/index.html 存在。
//! server.rs 通过 include_str! 嵌入 Web 管理面板（vite 构建产物）。
//! 若前端未构建，生成占位页，保证 cargo 编译永远成功。

use std::fs;
use std::path::Path;

const PLACEHOLDER: &str = r#"<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>U60 Pro 管理面板</title>
<style>
  body{font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
       background:#0b0f17;color:#cbd5e1;display:flex;min-height:100vh;
       align-items:center;justify-content:center;margin:0}
  .box{max-width:540px;padding:2rem;text-align:center;line-height:1.8}
  code{background:#1e293b;padding:.15em .45em;border-radius:6px;color:#67e8f9}
  h1{font-size:1.3rem}
</style>
</head>
<body><div class="box">
  <h1>Web 管理面板未构建</h1>
  <p>此 zte-agent 二进制中嵌入的是占位页面。</p>
  <p>构建前端后重新编译即可：<br><code>cd web-admin &amp;&amp; pnpm install &amp;&amp; pnpm build</code></p>
  <p>REST API 不受影响：<code>POST /api/auth/login</code></p>
</div></body>
</html>"#;

fn main() {
    let dir = Path::new("web-dist");
    let index = dir.join("index.html");
    if !index.exists() {
        fs::create_dir_all(dir).expect("failed to create web-dist directory");
        fs::write(&index, PLACEHOLDER).expect("failed to write placeholder index.html");
    }
    // 前端重新构建后触发重编译（include_str! 也会跟踪，双保险）
    println!("cargo:rerun-if-changed={}", index.display());
}
