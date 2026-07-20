# U60 Pro Web 管理面板

类似 mihomo 面板风格的 ZTE U60 Pro 随身 WiFi Web 管理后台。
纯静态 SPA（React 18 + TypeScript + Tailwind CSS v4），构建为**单个 HTML 文件**，
通过 `include_str!` 嵌入 zte-agent 二进制，由 agent 直接在 `9090` 端口提供服务——
设备上无需任何额外的 Web 服务器，零额外资源占用。

## 功能

- **概览**：运营商/网络类型/信号、实时速率曲线、电池、CPU/内存/温度、流量统计、WiFi、客户端、进程 Top5
- **信号监测**：NR/LTE/WCDMA 实时面板、RSRP/SINR 历史曲线
- **短信**：会话收发、容量、转发规则配置、转发日志
- **电话**：拨号盘、来电接听/挂断、DTMF、静音、USSD、STK
- **移动网络**：数据开关、飞行模式、网络模式、运营商扫描注册、APN 管理
- **频段小区**：NR/LTE 频段锁、小区锁 + 邻区扫描、信号检测、STC
- **WiFi**：2.4G/5G 完整设置、访客网络
- **路由设置**：DNS + DoH、LAN/DHCP、防火墙、VPN 透传、QoS、域名过滤
- **SIM 卡**：信息/IMEI、PIN/PUK 管理、USSD、STK
- **设备管理**：重启/出厂、省电、快速启动、充电限制、USB 模式/充电宝
- **工具箱**：AT 终端、网速测试、LAN 测速、定时任务、进程管理

## 登录

使用 zte-agent 部署时设置的密码（`setup.sh` / `deploy.sh` 的 agent 密码）。
Bearer token 有效期 1 小时，存储在浏览器 localStorage。

## 开发

```bash
pnpm install
pnpm dev        # http://localhost:5173，/api 代理到 http://192.168.0.1:9090
                # 可用 ZTE_AGENT_URL 环境变量覆盖目标设备
```

## 构建

```bash
pnpm build      # tsc 检查 + vite 构建（vite-plugin-singlefile）
                # 产物输出到 ../zte-agent/web-dist/index.html
```

随后 `cargo build --release -p zte-agent` 会把该文件嵌入二进制。
`zte-agent/build.rs` 保证 web-dist/index.html 存在（未构建时生成占位页），
因此单独编译 agent 永远不会失败。

部署到设备（构建前端 + 交叉编译 + 推送 + 重启）：

```bash
./deploy.sh <agent-password>
```

部署完成后访问 `http://192.168.0.1:9090/`。
