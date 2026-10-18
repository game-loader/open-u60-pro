# Mihomo on the U60 Pro

`zte-agent` can install, configure and supervise [mihomo](https://github.com/MetaCubeX/mihomo)
on the router. The Web management panel exposes the same operations at **Mihomo**
in the sidebar.

Mihomo is **not bundled** with the agent. It is installed at runtime into
`/data/mihomo/bin/mihomo`, either by uploading an aarch64 binary/`.gz` or by
downloading a pinned release.

## Defaults

| Setting | Default |
|---|---|
| Started after install | no |
| Start on boot (`autostart`) | **no** |
| Transparent proxy | **no** |
| Transparent mode | `auto` (TUN first, REDIRECT fallback) |
| REDIRECT blocks QUIC | yes |
| REDIRECT blocks IPv6 | no |
| Controller | `127.0.0.1:9091` (agent keeps `9090`) |

`Start`/`Stop` only affect the current run. They do not change `autostart`.
After a reboot, mihomo starts only when `autostart` is enabled and safe mode is
off.

## Install

### Upload

Use **Mihomo → 安装 / 升级 → 上传二进制**. The agent accepts:

- a raw aarch64 ELF (`ELF64`, little-endian, `e_machine == 183`)
- a gzip-compressed ELF

The upload is streamed to `/data/mihomo`, checked for architecture, executed
with `-v`, then atomically installed. The previous binary is kept as
`/data/mihomo/bin/mihomo.prev`.

### Download

The default pinned version is **v1.19.32**:

```text
sha256(gz)  = 9dd862e28b46ff7d775f169cceebc28deccaa0a9e804237d421cd2571e0caba0
sha256(bin) = c80df2ca5159567804da883401e0118908fc1155e05df2baf3dbd4d3ecfc3754
```

For a different version, provide the `.gz` SHA256. The agent downloads from
`https://github.com/MetaCubeX/mihomo/releases/download/<version>/mihomo-linux-arm64-<version>.gz`,
verifies it, decompresses it with the system `gzip`, and validates the ELF.
If GitHub is unreachable, use the upload path.

## Configuration

The editor stores the original YAML at `/data/mihomo/config.yaml` and never
rewrites it. Before every start the agent generates
`/data/mihomo/runtime.yaml` with the transparent-gateway keys, then validates
the runtime file with:

```sh
mihomo -t -d /data/mihomo -f /data/mihomo/runtime.yaml
```

Saving validates the config too. Saving while mihomo is running does **not**
apply it automatically: use **保存并重启** or restart from the status card.

`external-controller` and `secret` are passed on the command line and do not
need to be present in the YAML.

### Injected runtime keys

TUN mode:

```yaml
tun:
  enable: true
  stack: mixed
  auto-route: true
  auto-redirect: true
  auto-detect-interface: true
  device: mihomo0
  dns-hijack: ["any:53"]
  route-exclude-address: [private/reserved ranges]
dns:
  enable: true
  listen: 127.0.0.1:1053
```

REDIRECT mode forces `tun.enable: false`, ensures `redir-port: 7892`, and uses
the same DNS listener. `mixed-port` defaults to `7890` if the config does not
set one.

Direct mode injects no network settings. If your own YAML enables TUN or binds
`dns.listen` to port 53, mihomo will still honour it; the UI warns but does not
silently change it.

### DNS

In transparent mode, dnsmasq forwards to mihomo DNS at `127.0.0.1:1053` through
`/tmp/dnsmasq.d/mihomo.conf`. Any existing DoH drop-in is paused and restored
when mihomo stops. Enabling DoH while mihomo owns DNS returns HTTP 409; stop
mihomo first.

The agent adds safe bootstrap DNS defaults (`223.5.5.5`, `119.29.29.29`) only
when the YAML does not provide `default-nameserver`, `nameserver`, or
`proxy-server-nameserver`. This prevents a dnsmasq → mihomo → dnsmasq loop.

## Transparent proxy

### TUN

`auto` prefers TUN. Mihomo's own `auto-route` + `auto-redirect` are used, so
there is less agent-managed firewall code. TUN covers LAN clients and the
router's own traffic. Private/reserved destinations (including CGNAT
`100.64.0.0/10` and the LAN range) are excluded from the TUN routes.

If `nft` is unavailable, the agent sets `DISABLE_NFTABLES=true` for mihomo.

### REDIRECT fallback

When TUN is unavailable or TUN startup fails, `auto` falls back to agent-managed
iptables:

- `MIHOMO_REDIR` in `nat` for LAN TCP
- `MIHOMO_QUIC` in `filter` for optional UDP/443 blocking
- `MIHOMO6` in `ip6tables` when `block_ipv6` is enabled

Only LAN interfaces are redirected; the router's own traffic is not. QUIC is
blocked by default so apps fall back to TCP; this can be disabled. IPv6 is
direct by default (a documented leak) and can be blocked.

The agent deletes the jumps and chains when mihomo stops. If mihomo dies
abnormally, the supervisor attempts the same cleanup and can enter safe mode.

## Safety and recovery

- `autostart` is off by default.
- Transparent startup runs a health check (process, controller, DNS, proxy,
  TUN/redirect presence). Failure rolls back DNS/firewall and enters safe mode.
- The agent writes `/data/mihomo/state/pending` while applying transparent
  mode. If the device reboots with that marker, it does not start mihomo, turns
  off autostart, and enters safe mode.
- Repeated crashes (more than three) also enter safe mode.
- **紧急恢复网络** in the UI calls `POST /api/mihomo/panic`: stops mihomo,
  removes routes/firewall/DNS, disables autostart and transparent mode, and
  enters safe mode.
- If the UI is unreachable, run:

  ```sh
  sh /data/mihomo/panic.sh
  ```

  The script does not depend on Python or the agent. A reboot is also safe while
  autostart is off.

Clear safe mode only after confirming that normal networking works.

## API

All endpoints require the normal Bearer token.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/mihomo/status` | process, mode, config, controller, memory |
| GET | `/api/mihomo/capabilities` | cached TUN/iptables/nft/dnsmasq probe |
| GET | `/api/mihomo/capabilities?force=1` | refresh the probe |
| GET | `/api/mihomo/proxies` | proxy groups and current node |
| PUT | `/api/mihomo/proxies` | select a node: `{group, name}` |
| GET | `/api/mihomo/config` | original YAML and metadata |
| PUT | `/api/mihomo/config` | save raw YAML (validated) |
| POST | `/api/mihomo/config/validate` | validate raw YAML |
| GET/PUT | `/api/mihomo/settings` | autostart, transparent, mode, QUIC/IPv6 |
| POST | `/api/mihomo/start` | start now |
| POST | `/api/mihomo/stop` | stop and restore network |
| POST | `/api/mihomo/restart` | stop + start |
| POST | `/api/mihomo/panic` | emergency cleanup |
| POST | `/api/mihomo/safe-mode/clear` | clear the safe-mode marker |
| GET | `/api/mihomo/logs?lines=200` | last log lines |
| POST | `/api/mihomo/logs/clear` | truncate the log |
| POST | `/api/mihomo/install/upload` | raw ELF or gzip body |
| POST | `/api/mihomo/install/download` | `{version, sha256}` |

## Files

```text
/data/mihomo/
├── bin/mihomo              (0755)
├── bin/mihomo.prev
├── config.yaml             (0600)
├── runtime.yaml            (0600)
├── settings.json           (0600)
├── logs/mihomo.log
├── run/mihomo.pid
├── state/pending
├── state/safe_mode
├── state/doh.conf.paused
└── panic.sh                (0755)
```

## Limitations

- First version supports the Web panel only; the mobile apps do not have a
  Mihomo page.
- No subscription URL, delay testing, or mihomo's own dashboard. Node switching is available for `type: select` groups.
- REDIRECT fallback proxies LAN IPv4 TCP only. It does not proxy UDP or IPv6,
  and it does not proxy the router's own traffic.
- TUN/route behaviour depends on the device kernel and QCMAP; the agent probes
  and falls back, but real-device validation is required.
- Installing a new binary does not restart a running mihomo automatically.
