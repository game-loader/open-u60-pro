# Mihomo 集成设计

- **状态**: 已实现（2026-10-18），真实设备透明代理待实测
- **日期**: 2026-10-18
- **仓库**: `game-loader/open-u60-pro`
- **涉及组件**: `zte-agent`（Rust）、`web-admin`（React/Vite）
- **目标设备**: ZTE U60 Pro (MU5250)，aarch64，OpenWrt 23.05 / ZWRT

> 实现状态：设备端模块、REST API、Web 面板、单元测试和交叉编译已完成。真实设备上的
> TUN/iptables/REDIRECT、DNS 接管和回滚仍需按 §15.4 清单实测；本机运行测试使用 amd64
> mihomo 验证了配置、启停、自启、安全模式和 API，未在 aarch64 真机上执行。

---

## 1. 摘要

在 `zte-agent` 中新增一个 **agent 托管的 mihomo sidecar**，并在 Web 管理面板中提供管理页面。

核心能力：

1. 安装/升级 mihomo（浏览器上传或 agent 在线下载）
2. 编辑、上传、下载并校验原始 `config.yaml`
3. 启动、停止、重启 mihomo
4. 独立的“开机自启”开关，**默认关闭**
5. 透明代理网关：优先 TUN，失败回退到 iptables REDIRECT
6. DNS 接管、健康检查、故障自动回滚、紧急恢复
7. 状态、日志、能力探测和风险提示

不把 mihomo 二进制放进仓库或 release 包；运行时安装到 `/data/mihomo/bin/mihomo`。

---

## 2. 目标

- 用户可以在 Web 面板中完成 mihomo 的安装、配置、启停和排障。
- 默认安装后、默认重启后 **不会运行 mihomo**。
- 用户显式开启透明代理后，LAN 客户端流量通过 mihomo。
- TUN 不可用或启动失败时，透明模式自动回退到 REDIRECT，而不是直接不可用。
- 任何透明代理失败都不能把设备留在断网状态；必须有自动回滚和人工恢复路径。
- 后端 API 保持通用，未来 iOS/Android 可以直接复用。

## 3. 非目标

第一版明确不做：

- iOS / Android 的 Mihomo 页面
- 订阅 URL 拉取、定时更新
- 代理组延迟测试（节点切换已支持 `type: select` 组）
- mihomo 自带的 Web Dashboard（metacubexd/yacd）
- 按设备/按 MAC/按域名分流的可视化规则编辑器
- REDIRECT 回退模式下的 IPv6 透明代理和 UDP/QUIC 代理
- REDIRECT 回退模式下代理路由器自身流量
- 自动升级 mihomo（只做手动上传/下载）
- 多实例 mihomo

---

## 4. 已确认的决策

| 决策 | 结论 |
|---|---|
| 集成方式 | Agent 托管 sidecar（方案 A） |
| 透明代理 | TUN 优先，失败自动回退 REDIRECT |
| 二进制来源 | 浏览器上传 + agent 在线下载 |
| UI 范围 | 只做 Web 面板，后端 API 通用 |
| 配置管理 | 原始 YAML + 服务端校验；不做订阅/节点切换 |
| 默认开机自启 | `false` |
| REDIRECT 回退范围 | LAN IPv4 TCP；默认阻断 QUIC；IPv6 默认直连（可开关阻断） |
| TUN 范围 | LAN + 路由器自身流量 |
| 二进制版本 | 默认固定 `v1.19.32`，允许自定义版本 + 上传 |

---

## 5. 设备约束与调研结论

| 项目 | 结论 |
|---|---|
| Agent 端口 | `0.0.0.0:9090`，与 mihomo 默认 external-controller `9090` 冲突；本设计固定控制器为 `127.0.0.1:9091` |
| 文件系统 | rootfs 只读；mihomo 二进制、配置、日志全部放 `/data/mihomo` |
| 可用空间 | `/data` 约 1.7 GB 空闲；mihomo 二进制约 55 MB，`.gz` 约 20 MB |
| 内存 | 设备 1.6 GB；mihomo 空闲约 60–100 MB，可接受 |
| mihomo 二进制 | `v1.19.32` 官方 `linux-arm64` 为静态 aarch64 ELF，无 `PT_INTERP`，可在 musl 设备运行 |
| TUN | 设备是否可用尚未实测；必须启动前探测，不能假设 |
| 防火墙 | 设备为 QCMAP，使用 legacy iptables；`nft` 可能不存在 |
| mihomo auto-redirect | 默认优先 nftables；可通过 `DISABLE_NFTABLES=true` 强制走 iptables |
| DNS | dnsmasq 监听 `192.168.0.1:53`；现有 DoH 使用 `127.0.0.1:5353` |
| mihomo CLI | 已确认支持 `-d`、`-f`、`-t`、`-ext-ctl`、`-secret` |
| mihomo 下载 | GitHub release 不提供 checksum 资产；固定版本需在代码中内置 SHA256 |

固定版本的校验值：

```text
v1.19.32 mihomo-linux-arm64-v1.19.32.gz
sha256(gz)  = 9dd862e28b46ff7d775f169cceebc28deccaa0a9e804237d421cd2571e0caba0
sha256(bin) = c80df2ca5159567804da883401e0118908fc1155e05df2baf3dbd4d3ecfc3754
```

---

## 6. 总体架构

### 6.1 组件

| 组件 | 位置 | 职责 |
|---|---|---|
| `mihomo` 模块 | `zte-agent/src/mihomo/` | 生命周期、监控、配置、网络、控制器 |
| `MihomoManager` | `zte-agent/src/mihomo/mod.rs` | 进程启停、supervisor、状态机、adoption |
| 配置模块 | `zte-agent/src/mihomo/config.rs` | settings 持久化、YAML 合并、运行时配置生成 |
| 二进制模块 | `zte-agent/src/mihomo/binary.rs` | 上传、下载、解压、ELF/SHA256/版本校验 |
| 网络模块 | `zte-agent/src/mihomo/network.rs` | 能力探测、TUN/REDIRECT、DNS、清理、健康检查 |
| 控制器客户端 | `zte-agent/src/mihomo/controller.rs` | 访问 `127.0.0.1:9091` 的 mihomo REST API |
| HTTP handlers | `zte-agent/src/mihomo/handlers.rs` | 将 manager 暴露为 REST 端点 |
| Web 页面 | `web-admin/src/pages/Mihomo.tsx` | 状态、配置、安装、日志、透明模式 |
| Web API 客户端 | `web-admin/src/lib/api.ts` + `mihomo.ts` | JSON、原始 YAML、二进制上传 |

### 6.2 接入点

- `handlers.rs` 的 `AppState` 新增 `pub mihomo: Arc<crate::mihomo::MihomoManager>`
- `main.rs` 初始化 manager，并在事件总线启动后调用 `mihomo.auto_start()`
- `server.rs` 新增路由；二进制上传必须在通用 body 读取之前处理
- 不新增 init 脚本、不修改 `/etc/rc.local`；开机行为完全由 agent 控制

### 6.3 存储布局

```text
/data/mihomo/                     (0700, root)
├── bin/
│   ├── mihomo                    (0755)
│   └── mihomo.prev               (0755, 可选)
├── config.yaml                   (0600, 用户原始配置)
├── runtime.yaml                  (0600, agent 生成的运行时配置)
├── settings.json                 (0600, agent 设置)
├── logs/
│   └── mihomo.log                (0640, 自动轮转)
├── run/
│   └── mihomo.pid                (0644)
├── state/
│   ├── pending                   (透明模式应用中的标记)
│   └── safe_mode                 (安全模式标记)
└── panic.sh                      (0755, 本地紧急恢复脚本)
```

### 6.4 关键端口

| 用途 | 地址 |
|---|---|
| zte-agent HTTP/Web | `0.0.0.0:9090` |
| mihomo external-controller | `127.0.0.1:9091` |
| mihomo mixed proxy | 默认 `7890`（若用户配置已有则沿用） |
| mihomo redirect | 默认 `7892`（REDIRECT 模式） |
| mihomo DNS | `127.0.0.1:1053` |
| dnsmasq | `192.168.0.1:53` |
| DoH proxy | `127.0.0.1:5353` |

控制器只绑定 loopback，并使用随机 secret；不会暴露到 LAN。

---

## 7. 状态模型与生命周期

### 7.1 状态

```text
not_installed
    │ install
    ▼
stopped ──start──▶ starting ──success──▶ running
    ▲                 │                    │
    │                 │ failure            │ stop
    │                 ▼                    ▼
    └──────────── error ◀────────────── stopping
```

`running` 下有三种有效网络模式：

- `direct`：不改路由/防火墙/DNS，mihomo 只按自身配置提供代理
- `tun`：mihomo TUN + auto-route + auto-redirect
- `redirect`：agent 管理的 iptables REDIRECT

### 7.2 两个独立概念

| 字段 | 含义 | 默认 |
|---|---|---|
| `desired_running` | 当前是否希望 mihomo 运行；用于 agent 重启后恢复 | `false` |
| `autostart` | 设备重启后是否自动启动 | `false` |

规则：

- `POST /start` 只设置 `desired_running=true`，不改变 `autostart`
- `POST /stop` 只设置 `desired_running=false`，不改变 `autostart`
- 只有 `autostart=true` 才会在设备重启后启动
- 关闭 `autostart` 不会停止当前进程；UI 分别展示

完整默认设置：

| 字段 | 默认值 |
|---|---|
| `autostart` | `false` |
| `desired_running` | `false` |
| `transparent` | `false` |
| `transparent_mode` | `auto` |
| `block_quic` | `true` |
| `block_ipv6` | `false` |
| `safe_mode` | `false` |

`settings.json` 使用临时文件 + rename 原子写入，避免断电留下半截 JSON。

### 7.3 设备重启 vs agent 重启

读取 `/proc/sys/kernel/random/boot_id`：

- **boot_id 变化**：设备重启过
  - `autostart=true` 且 `safe_mode=false` 且 `state/safe_mode` 不存在且已安装：等待 WAN 可用后启动
  - 否则保持停止
- **boot_id 未变**：只是 agent 重启（例如 deploy）
  - `desired_running=true`：接管现有进程；接管失败则重启
  - `desired_running=false`：发现孤儿 mihomo 时停止它

不同 boot_id 写入 `settings.json` 的 `last_boot_id`。

### 7.4 启动等待 WAN

设备重启后，若需要自动启动：

- 最多等待 120 秒，让 `zte_topsw_data` / WAN 可用
- 优先订阅 `router_event_wan_connect_status`；事件不可用时用 `ubus call network.interface.wan status` 轮询
- WAN 未就绪时不启动，记录 `last_error`，每 30 秒重试一次，最多 5 分钟
- 自动启动失败不得影响 agent 自身

### 7.5 崩溃与重启

- supervisor 每 5 秒检查子进程
- 非用户停止的退出：清理网络状态，按 5s / 15s / 30s 退避重启
- 5 分钟内连续失败 3 次：
  - 停止尝试
  - 恢复网络
  - 设置 `autostart=false`
  - 设置 `safe_mode=true` 并写入 `state/safe_mode` 标记
  - 记录 `last_error`
- 用户再次手动启动时允许清除 `safe_mode`（需要 UI 明确操作）

### 7.6 Agent 重启接管

- `run/mihomo.pid` 存在且进程名匹配 `mihomo`
- 用当前 controller secret 访问 `127.0.0.1:9091/version`
- 配置路径与运行时参数匹配
- 满足条件则接管，不重启进程
- 不满足则 SIGTERM 旧进程，清理后按当前设置重新启动

不设置 `PR_SET_PDEATHSIG`，因为需要支持 agent 重启后的接管。设备重启时由 init 杀死所有进程。

---

## 8. 配置管理

### 8.1 用户配置

- 路径：`/data/mihomo/config.yaml`
- 内容：用户提供的完整 mihomo YAML
- API 只读写这份文件；不因为透明模式而破坏用户原始配置
- 写入使用临时文件 + `fsync` + rename；保留上一版为 `config.yaml.prev`

### 8.2 运行时配置

- 路径：`/data/mihomo/runtime.yaml`
- 由 `config.yaml` 解析后注入网关设置生成
- 使用 `serde_yaml_ng = "0.10"` 解析和序列化
- 保留所有未知字段；注释/锚点不保证保留（原始文件不受影响）
- 每次启动前重新生成
- 生成后先做 `mihomo -t` 校验，通过后才允许启动

### 8.3 注入规则

| 配置键 | direct | TUN | REDIRECT |
|---|---|---|---|
| `tun.enable` | 不修改 | `true` | `false` |
| `tun.stack` | 不修改 | 缺省 `mixed` | 不修改 |
| `tun.auto-route` | 不修改 | `true` | 不修改 |
| `tun.auto-redirect` | 不修改 | `true` | 不修改 |
| `tun.auto-detect-interface` | 不修改 | `true` | 不修改 |
| `tun.dns-hijack` | 不修改 | `["any:53"]` | 不修改 |
| `tun.device` | 不修改 | 缺省 `mihomo0` | 不修改 |
| `tun.route-exclude-address` | 不修改 | 合并 LAN/保留地址 | 不修改 |
| `dns.enable` | 不修改 | `true` | `true` |
| `dns.listen` | 不修改 | `127.0.0.1:1053` | `127.0.0.1:1053` |
| `dns.enhanced-mode` | 不修改 | 缺省 `fake-ip` | 缺省 `fake-ip` |
| `dns.fake-ip-range` | 不修改 | 缺省 `198.18.0.1/16` | 缺省 `198.18.0.1/16` |
| `redir-port` | 不修改 | 不修改 | 缺省 `7892` |
| `mixed-port` | 缺省设 `7890` | 缺省设 `7890` | 缺省设 `7890` |
| `external-controller` | 不写入 | 不写入 | 不写入 |
| `secret` | 不写入 | 不写入 | 不写入 |

`external-controller` 和 `secret` 通过 CLI 参数覆盖，避免修改用户 YAML：

```text
mihomo -d /data/mihomo -f /data/mihomo/runtime.yaml \
       -ext-ctl 127.0.0.1:9091 -secret <random>
```

> **Direct 模式的例外**：direct 模式不注入网关设置，但如果用户原始配置本身启用了 `tun.enable` 或把 `dns.listen` 绑到 `53`，mihomo 仍会按配置执行。保存配置时 UI 必须检测并警告，避免用户以为“直连模式”不会改网络，结果实际创建了 TUN 或占用了 dnsmasq 的端口。

### 8.4 DNS 防环

mihomo DNS 不能再把 dnsmasq 当作上游，否则形成环。运行时配置在缺失时补充：

- `dns.default-nameserver`: `["223.5.5.5", "119.29.29.29"]`
- `dns.proxy-server-nameserver`: `["223.5.5.5", "119.29.29.29"]`
- `dns.nameserver`: 缺失时使用 `["223.5.5.5", "119.29.29.29"]`

如果用户配置已经提供这些字段，则不覆盖。UI 在“有效配置”区域展示实际使用的默认值。

### 8.5 端口与冲突校验

保存/启动前检查用户配置中的监听端口：

- `mixed-port`、`port`、`socks-port`、`redir-port`、`tproxy-port`、`dns.listen`、`external-controller`
- 禁止使用 `9090`（agent）
- 禁止 `dns.listen` 绑定 `53` 且 dnsmasq 正在运行
- 禁止 `external-controller` 绑定非 loopback 地址（CLI 会覆盖，但仍给出警告）
- 端口被其他进程占用时给出警告；启动失败时返回具体错误

### 8.6 校验

- YAML 解析错误：返回行/列和错误文本
- `mihomo -t -d /data/mihomo -f <临时 runtime>`：
  - 退出码 0：有效
  - 非 0：返回 stderr/stdout 的最后 8 KB
  - 超时 20 秒：返回超时错误
- 保存配置要求校验通过；`POST /config/validate` 允许只校验不保存
- 配置大小上限 1 MiB

### 8.7 配置生效

- 保存配置不会自动重启正在运行的 mihomo
- API 返回 `needs_restart: true`
- UI 提供“保存”“保存并重启”
- 第一版不做 mihomo controller 的热重载；TUN/DNS 变更必须完整重启

---

## 9. 二进制安装

### 9.1 上传

`POST /api/mihomo/install/upload`

- `Content-Type: application/octet-stream`
- 原始 ELF 或 gzip 压缩的 ELF
- 上限：上传体 ≤ 150 MiB；解压后 ≤ 150 MiB
- 流式写入临时文件，不整块读入内存
- gzip 通过系统 `gzip -dc` 解压（设备 busybox 提供）
- 校验：
  - ELF64、little-endian、`e_machine == 0xB7`（AArch64）
  - 可执行权限
  - `mihomo -v` 在 10 秒内成功执行
- 通过后原子替换 `bin/mihomo`，旧文件保留为 `bin/mihomo.prev`
- 失败时删除临时文件，不破坏现有二进制

### 9.2 在线下载

`POST /api/mihomo/install/download`

请求：

```json
{
  "version": "v1.19.32",
  "sha256": "9dd862e28b46ff7d775f169cceebc28deccaa0a9e804237d421cd2571e0caba0"
}
```

- `version` 必须匹配 `^v?\d+\.\d+\.\d+$`；缺少 `v` 时规范化为 `v1.19.32` 形式，再用于 URL 和版本表查找
- 未提供 `sha256` 时，只允许使用内置版本表
- 内置版本表第一项：`v1.19.32` + 上面的 gz SHA256 + bin SHA256
- URL 模板：
  `https://github.com/MetaCubeX/mihomo/releases/download/{version}/mihomo-linux-arm64-{version}.gz`
- 下载超时 180 秒；流式写入临时文件
- 校验 gz SHA256，解压后再校验 bin SHA256 和 ELF
- 后续校验与上传路径一致
- GitHub 不可达时返回明确错误，提示用户改用上传

### 9.3 版本与状态

- `GET /api/mihomo/status` 返回已安装版本、大小、SHA256、安装时间、来源
- 版本通过 `mihomo -v` 解析
- 不自动更新；不把二进制写入 release

---

## 10. 透明代理

### 10.1 能力探测

启动透明模式前执行，结果缓存到 status，可在 UI 手动刷新：

| 探测项 | 方法 |
|---|---|
| TUN 设备 | `/dev/net/tun` 存在？ |
| TUN 可用 | `ip tuntap add mode tun name mihomo-probe`，成功则删除 |
| iptables | `iptables -V` 和一次无害的链创建/删除 |
| ip6tables | `ip6tables -V`（仅 `block_ipv6` 需要） |
| nftables | `nft --version` 和 `nft list tables` |
| dnsmasq | `/etc/init.d/dnsmasq status` 或进程检查 |
| LAN 接口 | `ubus call network.interface.lan status` 的 `l3_device`，以及 `/sys/class/net/br-*` |
| root | `geteuid() == 0` |

TUN 探测失败时不尝试创建 `/dev/net/tun`；直接回退。

### 10.2 TUN 模式

优先使用 mihomo 自带的 `auto-route` + `auto-redirect`，减少自定义路由/防火墙代码。

运行时配置附加：

```yaml
tun:
  enable: true
  stack: mixed
  auto-route: true
  auto-redirect: true
  auto-detect-interface: true
  device: mihomo0
  dns-hijack:
    - any:53
  route-exclude-address:
    - 0.0.0.0/8
    - 10.0.0.0/8
    - 100.64.0.0/10
    - 127.0.0.0/8
    - 169.254.0.0/16
    - 172.16.0.0/12
    - 192.168.0.0/16
    - 224.0.0.0/4
    - 240.0.0.0/4
```

- `include-interface` 第一版不设置；TUN 覆盖 LAN + 路由器自身流量
- `strict-route` 保持 `false`，避免 LAN 失联
- 如果 `nft` 不可用，启动 mihomo 时设置环境变量 `DISABLE_NFTABLES=true`
- 如果 `auto-redirect` 初始化失败，自动回退 REDIRECT
- 停止时优先 SIGTERM，让 mihomo 清理 TUN/路由/iptables；超时后 SIGKILL
- 异常退出后的 best-effort 清理：
  - `ip link del mihomo0`
  - 按运行时记录的 `iproute2-table-index` / `iproute2-rule-index` 删除对应 `ip rule` 和路由表；缺省值使用 mihomo 默认值
  - 删除 nft 表 `mihomo`（如果存在）
  - 删除 iptables 中名为 `mihomo` 的链（如果存在）
  - 清理失败时记录错误，设置 `safe_mode=true`，禁止下次自启

### 10.3 REDIRECT 回退

仅当 TUN 不可用或 TUN 启动失败时使用。

iptables 规则使用独立链，避免影响 QCMAP：

```text
nat 表:
  MIHOMO_REDIR
    -d 0.0.0.0/8      -j RETURN
    -d 10.0.0.0/8     -j RETURN
    -d 100.64.0.0/10  -j RETURN
    -d 127.0.0.0/8    -j RETURN
    -d 169.254.0.0/16 -j RETURN
    -d 172.16.0.0/12  -j RETURN
    -d 192.168.0.0/16 -j RETURN
    -d 224.0.0.0/4    -j RETURN
    -d 240.0.0.0/4    -j RETURN
    -p tcp --dport <redir-port> -j RETURN
    -p tcp --dport 7890 -j RETURN
    -p tcp --dport 9090 -j RETURN
    -p tcp --dport 9091 -j RETURN
    -p tcp -j REDIRECT --to-ports <redir-port>

对每个 LAN 接口:
  iptables -t nat -I PREROUTING 1 -i <lan> -j MIHOMO_REDIR
```

- 使用 `iptables -w 5` 等待 xtables 锁
- 只在 LAN 接口入方向生效；路由器自身流量不经过 PREROUTING，因此不被代理
- 停止/失败时先删除 PREROUTING 跳转，再 flush/delete 链
- 规则应用采用事务：任一步失败都回滚已应用的步骤

### 10.4 QUIC 与 IPv6

REDIRECT 回退模式：

- `block_quic` 默认 `true`
  - `filter` 表创建 `MIHOMO_QUIC`
  - 对每个 LAN 接口：`iptables -I FORWARD 1 -i <lan> -j MIHOMO_QUIC`
  - `MIHOMO_QUIC` 内先对保留/私网目的地址 `RETURN`，再 `-p udp --dport 443 -j REJECT`，避免误伤局域网内的 QUIC
  - 目的：强制客户端回退 TCP，避免 QUIC 绕过代理
  - UI 可关闭
- `block_ipv6` 默认 `false`
  - `true` 时 `ip6tables` 对 LAN 入方向 `FORWARD` 拒绝
  - 这是粗粒度阻断，可能同时影响 LAN 本地 IPv6 服务；UI 必须明确警告
  - 默认直连，UI 明确提示“IPv6 可能绕过代理”
- TUN 模式不设置 QUIC 阻断；UDP 由 TUN 处理

### 10.5 DNS 接管

透明模式启用时：

1. mihomo DNS 监听 `127.0.0.1:1053`
2. 写 `/tmp/dnsmasq.d/mihomo.conf`：

   ```text
   server=127.0.0.1#1053
   no-resolv
   ```

3. 如果 DoH 的 `/tmp/dnsmasq.d/doh.conf` 存在，移动到 `/data/mihomo/state/doh.conf.paused`
4. 重启 dnsmasq
5. 停止时：
   - 删除 `mihomo.conf`
   - 恢复 `doh.conf.paused`
   - 重启 dnsmasq

DoH 与 mihomo 的优先级：

- 透明模式启用期间，DoH 的 dnsmasq 上游被暂停
- 用户此时调用 DoH 启用接口，返回 `409`：“Mihomo 透明代理正在接管 DNS，请先停止”
- 透明模式停止后恢复原有 DoH 状态

DNS 健康检查：

- 向 `127.0.0.1:1053` 发送最小 A 查询
- 期望收到有效响应
- fake-ip 模式下期望返回 `198.18.0.0/16` 范围内的地址

### 10.6 LAN 接口与流量范围

- 自动检测 LAN 桥接口
  - 首选 `ubus call network.interface.lan status` 的 `l3_device`
  - 补充 `/sys/class/net/br-*` 中带私有 IPv4 的接口
  - 排除 WAN、`lo`、`rmnet*`、`mihomo0`
- settings 中允许覆盖 `lan_interfaces`（高级项）
- TUN：LAN + 路由器自身流量
- REDIRECT：仅 LAN IPv4 TCP
- UI 显示实际生效的接口列表

### 10.7 健康检查

启动透明模式后 10 秒内检查：

1. mihomo 进程存活
2. controller `GET /version` 成功
3. 使用运行时配置中的有效 `mixed-port`（缺省 7890）请求 `http://www.gstatic.com/generate_204` 或 `http://cp.cloudflare.com/generate_204`，任一成功即可
4. mihomo DNS 查询成功
5. TUN 模式：`ip link show mihomo0` 存在
6. REDIRECT 模式：iptables 跳转规则存在
7. agent 自身仍可响应（当前 HTTP 请求即为证明）

失败处理：

- 停止 mihomo
- 清理 TUN/iptables/DNS
- 恢复 dnsmasq
- 设置 `last_error`
- 设置 `autostart=false`
- 设置 `safe_mode=true` 并写入 `state/safe_mode` 标记
- 返回 500 + 错误详情

运行中每 30 秒重复 1–4；连续 3 次失败则执行同样的回滚。

### 10.8 事务与安全模式

透明模式应用前：

1. 写 `/data/mihomo/state/pending`
2. 记录 DNS 状态（DoH 文件是否存在）
3. 启动 mihomo / 应用规则
4. 健康检查
5. 成功后删除 `pending`

设备重启时：

- 若 `state/pending` 存在：
  - 不启动 mihomo
  - 设置 `autostart=false`
  - 设置 `safe_mode=true` 并写入 `state/safe_mode` 标记
  - 删除 `pending`
  - 记录错误
- 若 `safe_mode=true` 或 `state/safe_mode` 存在：
  - 不自动启动
  - UI 顶部显示安全模式横幅
  - 用户必须点击“清除安全模式”才能再次启用自启

`POST /api/mihomo/panic`：

- 停止 mihomo
- 清理防火墙/TUN 路由/DNS
- 恢复 dnsmasq/DoH
- 设置 `autostart=false`、`transparent=false`、`safe_mode=true`
- 返回恢复结果

`/data/mihomo/panic.sh`：

- 在 agent 不可达时本地执行同样的清理
- 先 `kill`（SIGTERM），超时后再 `kill -9`
- 删除 `/tmp/dnsmasq.d/mihomo.conf`
- 恢复 `/data/mihomo/state/doh.conf.paused`
- 重启 dnsmasq
- 删除 `MIHOMO_REDIR` / `MIHOMO_QUIC` 链和跳转
- `ip link del mihomo0`（存在时）
- 删除 nft 表 `mihomo`，以及 iptables 中名为 `mihomo` 的链（存在时）
- 删除 `/data/mihomo/state/pending`
- `touch /data/mihomo/state/safe_mode`
- 不依赖 Python/Node

`state/safe_mode` 文件是 panic.sh 与 agent 之间的约定：

- agent 启动时若发现该文件，强制 `settings.autostart=false`、`transparent=false`，并同步 `settings.safe_mode=true`
- UI 执行“清除安全模式”时删除该文件，并写回 settings

---

## 11. REST API

统一响应格式沿用现有约定：

```json
{"ok": true, "data": {}}
{"ok": false, "error": "mihomo is not installed"}
```

所有端点要求 Bearer token；`/api/auth/login` 除外。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/mihomo/status` | 安装、运行、模式、健康、内存、最近错误 |
| GET | `/api/mihomo/capabilities` | TUN/iptables/nft/dnsmasq/LAN 接口探测（带缓存；`?force=1` 强制刷新） |
| GET | `/api/mihomo/proxies` | 代理组和当前节点 |
| PUT | `/api/mihomo/proxies` | 切换节点：`{group, name}` |
| GET | `/api/mihomo/config` | 返回原始 YAML、路径、大小、修改时间、校验状态 |
| PUT | `/api/mihomo/config` | 保存原始 YAML；要求校验通过；大小 ≤ 1 MiB |
| POST | `/api/mihomo/config/validate` | 只校验，不保存 |
| GET | `/api/mihomo/settings` | autostart、transparent、mode、block_quic、block_ipv6 |
| PUT | `/api/mihomo/settings` | 部分更新；透明模式变更返回 `needs_restart` |
| POST | `/api/mihomo/start` | 启动；默认使用 settings；超时 60 秒 |
| POST | `/api/mihomo/stop` | 停止并恢复网络 |
| POST | `/api/mihomo/restart` | 停止 + 启动 |
| POST | `/api/mihomo/panic` | 紧急恢复网络并关闭自启 |
| POST | `/api/mihomo/safe-mode/clear` | 清除安全模式标记 |
| GET | `/api/mihomo/logs?lines=200` | 返回最后 N 行；上限 2000 |
| POST | `/api/mihomo/logs/clear` | 清空日志 |
| POST | `/api/mihomo/install/upload` | 原始/ gzip 二进制上传；流式处理 |
| POST | `/api/mihomo/install/download` | 在线下载固定/指定版本 |

### 11.1 status 响应示例

```json
{
  "ok": true,
  "data": {
    "installed": true,
    "version": "v1.19.32",
    "binary_sha256": "c80df2ca5159567804da883401e0118908fc1155e05df2baf3dbd4d3ecfc3754",
    "binary_size": 57409662,
    "running": true,
    "pid": 12345,
    "uptime_secs": 120,
    "desired_running": true,
    "autostart": false,
    "transparent": true,
    "requested_mode": "auto",
    "effective_mode": "tun",
    "safe_mode": false,
    "config": {
      "path": "/data/mihomo/config.yaml",
      "runtime_path": "/data/mihomo/runtime.yaml",
      "valid": true,
      "modified_at": 1760000000
    },
    "network": {
      "lan_interfaces": ["br-lan"],
      "dns_override": true,
      "quic_blocked": false,
      "ipv6_blocked": false
    },
    "controller": {
      "address": "127.0.0.1:9091",
      "reachable": true
    },
    "memory_kb": 82000,
    "last_error": null
  }
}
```

不得在 status 中返回 controller secret。

### 11.2 错误码

| 状态码 | 场景 |
|---|---|
| 400 | 参数/YAML/版本/校验失败 |
| 401 | 未认证 |
| 409 | 生命周期操作进行中、DoH 冲突、需要先停止 |
| 413 | 配置或二进制超过上限 |
| 500 | 启动/停止/网络应用失败 |
| 503 | 未安装、dnsmasq 不可用、能力不足 |

---

## 12. Web 管理面板

新增导航项 **Mihomo**（放在“工具箱”之后或“设备管理”之后），路由 `/mihomo`。

页面分区：

### 12.1 状态卡

- 安装状态、版本、运行状态、PID、uptime、内存
- 当前请求模式 / 实际生效模式（direct/tun/redirect）
- Start / Stop / Restart
- 开机自启 Toggle（默认关）
- 透明代理 Toggle + 模式选择（auto/tun/redirect）
- 紧急恢复按钮
- 安全模式横幅与“清除安全模式”
- 最近错误

### 12.2 能力卡

- TUN 是否可用
- iptables / nftables 版本
- dnsmasq 是否运行
- LAN 接口列表
- 探测失败原因与建议

### 12.2a 代理组 / 节点卡

- 列出 `proxies` 中带 `all` 的代理组
- `type: selector` 组提供节点下拉切换；其他组只显示当前节点
- 切换失败时回读控制器状态

### 12.3 配置卡

- 原始 YAML 编辑器（等宽字体 textarea）
- 校验 / 保存 / 保存并重启
- 上传 `.yaml` / 下载 `config.yaml`
- 恢复示例模板
- 校验错误展示（行/列/stderr）
- 有效运行时设置预览（TUN/DNS/端口）

### 12.4 安装卡

- 当前版本、大小、SHA256
- 上传二进制（支持 ELF / `.gz`，显示上传进度）
- 在线下载：版本输入 + SHA256（默认填充固定版本）
- 安装风险提示

### 12.5 日志卡

- 最后 200 行，自动/手动刷新
- 清空
- 复制

### 12.6 风险提示

启用透明模式前弹出确认框，明确：

- 会修改路由/防火墙/DNS
- 可能导致 LAN 断网
- 默认不会开机自启
- 失联时运行 `/data/mihomo/panic.sh` 或重启设备
- 需要用户勾选“我了解风险”

同时开启“透明模式 + 开机自启”时二次确认。

---

## 13. 安全

- `/data/mihomo` 目录 `0700`，配置/设置 `0600`，二进制 `0755`
- controller 只绑定 `127.0.0.1`，secret 为 32 字节随机 hex
- secret 不通过 API 返回；仅 mihomo 进程和 agent 内部使用
- 上传二进制校验 ELF/AArch64/`mihomo -v`；下载校验 SHA256
- 版本字符串白名单正则，禁止路径注入
- 固定文件路径，不使用用户输入拼接路径
- 配置/日志可能包含代理凭据；API 要求认证。前端只持久化 bearer token，配置和日志不写入浏览器持久存储
- 透明模式 API 仅 LAN 可达（agent 本身只监听 LAN）
- 所有破坏性操作（panic、停止、应用透明模式）需要认证

---

## 14. 错误处理

| 场景 | 行为 |
|---|---|
| 未安装 | `start` 返回 503，提示先安装 |
| 配置无效 | 保存/启动返回 400 + 校验错误 |
| TUN 不可用 | `auto` 回退 REDIRECT；`tun` 强制模式返回错误 |
| REDIRECT 规则失败 | 回滚已应用规则，恢复 DNS，返回 500 |
| controller 不可达 | 启动失败；supervisor 重试 |
| mihomo 崩溃 | 清理 + 退避重启；3 次失败进入安全模式 |
| DNS 应用失败 | 回滚 dnsmasq，停止 mihomo |
| agent 重启 | 接管或重启；不重复应用规则 |
| 设备重启 + pending | 安全模式，不自启 |
| 下载 GitHub 不可达 | 返回明确错误，建议上传 |
| 磁盘空间不足 | 安装/启动前检查，返回错误 |

---

## 15. 测试

### 15.1 Rust 单元测试

纯函数测试，不执行设备命令：

- settings 默认值：`autostart=false`、`desired_running=false`、`safe_mode=false`
- YAML 合并：
  - 保留用户 proxies/rules/proxy-groups
  - TUN 注入正确
  - REDIRECT 注入正确
  - DNS 默认值防环
  - 用户已有字段不被覆盖
- 端口冲突校验
- ELF 校验：AArch64 接受；x86/脚本/截断拒绝
- SHA256 校验
- REDIRECT 规则生成：排除项、顺序、LAN 接口、清理顺序
- 配置大小/上传大小限制
- boot_id 状态转换
- safe_mode / pending 逻辑

### 15.2 Web 构建

- `cd web-admin && pnpm install --frozen-lockfile && pnpm build`
- TypeScript 严格检查通过
- 上传进度、错误展示、确认框可用

### 15.3 编译验证

- 本机使用 Docker 运行 `cargo check` / `cargo test`
- 交叉编译：`aarch64-unknown-linux-musl`（CI release workflow 已具备）
- 现有 release workflow 会构建 web-admin + agent；新增依赖必须通过

### 15.4 设备实测清单

1. 全新安装，确认 mihomo 未运行
2. 重启，确认默认不自启
3. 上传正确/错误架构二进制
4. 在线下载固定版本
5. direct 模式启动、停止
6. TUN 模式：LAN 客户端访问外网、DNS、局域网设备、agent UI
7. 停止后路由/iptables/DNS 恢复
8. 强制 TUN 不可用，验证 REDIRECT 回退
9. REDIRECT：TCP 生效、QUIC 阻断、IPv6 直连/阻断
10. 开启自启 + 重启，确认启动
11. 关闭自启 + 重启，确认不启动
12. kill mihomo，确认 supervisor 恢复
13. 连续失败，确认安全模式
14. agent 重启，确认接管
15. DoH + mihomo 切换，确认 DNS 恢复
16. panic 接口和 `panic.sh`
17. 配置错误、端口冲突、磁盘不足
18. 透明模式应用中断（模拟崩溃），确认 pending/安全模式

---

## 16. 部署与回滚

### 16.1 部署

- 不修改 `setup.sh` / `deploy.sh`
- 不新增 init 脚本
- mihomo 由 agent 在运行时安装到 `/data`
- `deploy.sh` 现有流程会重建 web-admin 并编译 agent
- release workflow 不需要新增 mihomo 资产

### 16.2 版本回滚

- 安装新二进制时保留 `bin/mihomo.prev`
- 启动失败时可手动恢复：

  ```sh
  # 先停止 mihomo，再替换二进制
  mv /data/mihomo/bin/mihomo.prev /data/mihomo/bin/mihomo
  ```

- 紧急恢复：

  ```sh
  sh /data/mihomo/panic.sh
  ```

- 设备重启：若 `autostart=false`（默认或 panic 后），mihomo 不会启动

---

## 17. 风险与缓解

| 风险 | 缓解 |
|---|---|
| TUN/路由与 QCMAP 冲突 | 启动前探测、TUN 优先但自动回退、健康检查、默认不开机自启 |
| DNS 与 DoH/dnsmasq 冲突 | 统一 DNS 覆盖层，暂停/恢复 DoH，停止时恢复 |
| 透明模式导致 LAN 失联 | 事务应用、10 秒健康检查、自动回滚、panic、重启兜底 |
| 设备重启后循环失败 | pending 标记、safe_mode、自动关闭 autostart |
| 二进制供应链 | ELF/AArch64、限定版本、SHA256、`mihomo -v` |
| nftables 缺失 | 探测 + `DISABLE_NFTABLES=true` |
| iptables 规则残留 | 独立链、事务回滚、停止清理、best-effort 异常清理 |
| 内存/闪存占用 | 状态展示 RSS；/data 约 1.7 GB 空闲 |
| mihomo 配置含订阅/密钥 | 文件权限 0600；API 认证；不下发到前端之外 |
| 蜂窝网络下自动休眠 | mihomo 可能维持连接；文档提示耗电/流量，默认不自启 |

---

## 18. 实施阶段

### 阶段 1：后端基础（不改网络）

- settings 持久化
- 配置读写/校验/运行时生成
- 二进制上传/下载/校验
- direct 模式启动/停止/重启
- status/logs/capabilities API
- supervisor 基础

### 阶段 2：Web 面板

- 导航/路由/页面
- 状态、启停、自启、配置编辑器、安装、日志
- 上传进度、确认框、错误展示

### 阶段 3：TUN 透明代理

- 能力探测
- TUN 运行时配置
- DNS 覆盖/DoH 协调
- 健康检查、事务、回滚

### 阶段 4：REDIRECT 回退

- iptables 链/跳转
- QUIC/IPv6 开关
- 清理与异常恢复

### 阶段 5：生命周期与安全

- boot_id、autostart、接管
- pending/safe_mode/panic
- 崩溃退避、自动关闭自启

### 阶段 6：测试与文档

- 单元测试
- Docker 编译/测试
- 设备清单
- `zte-agent/docs/mihomo.md`、README、Web README

每个阶段结束时保持可编译、可回滚；透明模式在阶段 3/4 完成前不对外启用。

---

## 19. 验收标准

- [ ] 默认安装后 mihomo 不运行
- [ ] 默认重启后 mihomo 不运行
- [ ] Web 面板可安装/替换 mihomo 二进制
- [ ] 可编辑、校验、保存、上传、下载 YAML
- [ ] 可在 selector 组中切换节点
- [ ] 可启动/停止/重启 direct 模式
- [ ] 可单独开关“开机自启”
- [ ] TUN 透明模式可让 LAN 客户端经代理上网
- [ ] TUN 不可用时自动回退 REDIRECT
- [ ] 停止后路由/iptables/DNS 恢复
- [ ] 透明模式失败自动回滚并进入安全模式
- [ ] 支持 panic 接口和本地 `panic.sh`
- [ ] controller 使用 9091，不冲突 9090
- [ ] 单元测试、web 构建、Docker 编译通过
- [ ] 设备实测清单完成并记录结果

---

## 20. 明确不做

- 移动端 Mihomo 页面
- 订阅 URL / 自动更新
- 代理组/节点切换
- mihomo 自带 Dashboard
- 按设备/按 MAC 分流
- REDIRECT 模式 IPv6/UDP 代理
- REDIRECT 模式代理路由器自身流量
- 多实例
- 自动升级
