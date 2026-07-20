import { useMemo, useState } from 'react'
import {
  Signal as SignalIcon,
  ArrowDownUp,
  BatteryCharging,
  Cpu,
  MemoryStick,
  Thermometer,
  Wifi,
  Users,
  DatabaseZap,
  Activity,
  Trash2,
  RefreshCw,
} from 'lucide-react'
import { api, fetchAll } from '../lib/api'
import { usePoll, useSeries } from '../lib/hooks'
import { fmtBytes, fmtSpeed, fmtUptime, fmtPercent, rsrpLevel, num, num0 } from '../lib/format'
import { parseSignal, rsrpToBars, type ParsedSignal } from '../lib/signal'
import { Card, Stat, Badge, Button, Progress, KV } from '../components/ui'
import { LineChart, SignalBars as SB } from '../components/LineChart'
import { toast } from '../components/ui'

interface DashState {
  signal: ParsedSignal | null
  speed: { rx_speed: number; tx_speed: number } | null
  battery: any | null
  charger: any | null
  chargeControl: any | null
  thermal: any | null
  cpu: { cores: number[]; overall: number } | null
  memory: any | null
  device: any | null
  usage: any | null
  wifi: any | null
  clients: any | null
  top: any | null
}

const initial: DashState = {
  signal: null, speed: null, battery: null, charger: null, chargeControl: null,
  thermal: null, cpu: null, memory: null, device: null, usage: null, wifi: null,
  clients: null, top: null,
}

export default function Dashboard() {
  const [st, setSt] = useState<DashState>(initial)
  const { series: speedSeries, push: pushSpeed } = useSeries<{ rx: number; tx: number }>(40)
  const [killing, setKilling] = useState(false)

  // 快组：信号 + 网速，3s
  usePoll(async () => {
    const r = await fetchAll({
      signal: () => api.get('/api/network/signal'),
      speed: () => api.get('/api/network/speed'),
    })
    setSt((p) => ({
      ...p,
      signal: r.signal ? parseSignal(r.signal) : p.signal,
      speed: r.speed ?? p.speed,
    }))
    if (r.speed) pushSpeed({ rx: num0(r.speed.rx_speed), tx: num0(r.speed.tx_speed) })
  }, 3000)

  // 慢组：其余，12s
  usePoll(async () => {
    const r = await fetchAll({
      battery: () => api.get('/api/device/battery-info'),
      charger: () => api.get('/api/device/charger'),
      chargeControl: () => api.get('/api/device/charge-control'),
      thermal: () => api.get('/api/device/thermal'),
      cpu: () => api.get('/api/cpu'),
      memory: () => api.get('/api/memory'),
      device: () => api.get('/api/device'),
      usage: () => api.get('/api/data-usage'),
      wifi: () => api.get('/api/wifi/status'),
      clients: () => api.get('/api/network/clients'),
      top: () => api.get('/api/system/top'),
    })
    setSt((p) => ({ ...p, ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v ?? (p as any)[k]])) }))
  }, 12000)

  const sig = st.signal
  const rsrp = sig?.bestRsrp ?? null
  const level = rsrpLevel(rsrp)
  const batCap = num(st.battery?.battery_capacity ?? st.chargeControl?.capacity)
  const charging = useMemo(() => {
    const connected = num(st.charger?.charger_connect) === 1
    const stopped = st.chargeControl?.charging_stopped === true
    const status = num(st.charger?.charge_status)
    if (connected && stopped) return '已停止充电'
    if (status === 1) return '充电中'
    if (connected) return '已连接电源'
    return '使用电池'
  }, [st.charger, st.chargeControl])

  const clients = useMemo(() => {
    const hosts = st.clients?.hosts
    if (!hosts || typeof hosts !== 'object') return []
    return Object.entries(hosts).map(([mac, h]: [string, any]) => ({
      mac,
      name: h?.name || '未知设备',
      ip: h?.ipaddrs?.[0] || h?.ipv4 || '--',
    }))
  }, [st.clients])

  const killBloat = async () => {
    setKilling(true)
    try {
      const r = await api.post('/api/system/kill-bloat', { all: true })
      toast.success(`已清理 ${r.killed?.length ?? 0} 个进程，释放 ${fmtBytes((r.freed_rss_kb ?? 0) * 1024)}`)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setKilling(false)
    }
  }

  const cpuTemp = num(st.thermal?.cpuss_temp)

  return (
    <div className="space-y-4">
      {/* 顶部 4 状态卡 */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Card pad>
          <Stat
            icon={<SignalIcon size={18} />}
            label="蜂窝网络"
            value={
              <span className="flex items-center gap-2">
                {sig?.op.provider || '--'}
                {sig && <SB level={rsrpToBars(rsrp)} />}
              </span>
            }
            sub={
              sig ? (
                <span className="flex items-center gap-1.5">
                  <Badge tone={sig.displayType.includes('5G') ? 'brand' : 'slate'}>{sig.displayType}</Badge>
                  {sig.op.roaming && <Badge tone="yellow">漫游</Badge>}
                </span>
              ) : '--'
            }
          />
        </Card>
        <Card pad>
          <Stat
            icon={<ArrowDownUp size={18} />}
            label="实时速率"
            value={
              <span className="tabular">
                <span className="text-brand-500">↓</span> {fmtSpeed(st.speed?.rx_speed)}
              </span>
            }
            sub={
              <span className="tabular">
                <span className="text-emerald-500">↑</span> {fmtSpeed(st.speed?.tx_speed)}
              </span>
            }
          />
        </Card>
        <Card pad>
          <Stat
            icon={<BatteryCharging size={18} />}
            label="电池"
            value={batCap != null ? `${batCap}%` : '--'}
            sub={charging}
          />
          {batCap != null && <Progress value={batCap} tone="auto" className="mt-2" />}
        </Card>
        <Card pad>
          <Stat
            icon={<Cpu size={18} />}
            label="CPU / 内存"
            value={`${fmtPercent(st.cpu?.overall)} / ${fmtPercent(st.memory?.usage_pct)}`}
            sub={cpuTemp != null ? `CPU 温度 ${cpuTemp.toFixed(1)}°C` : (st.device ? `负载 ${st.device.load_avg?.map((l: number) => l.toFixed(2)).join(' ')}` : '--')}
          />
          <div className="mt-2 flex gap-2">
            <Progress value={num0(st.cpu?.overall)} tone="auto" className="flex-1" />
            <Progress value={num0(st.memory?.usage_pct)} tone="auto" className="flex-1" />
          </div>
        </Card>
      </div>

      {/* 网速曲线 */}
      <Card
        title="实时网速"
        icon={<Activity size={15} />}
        extra={<span className="text-xs text-slate-400">最近 2 分钟</span>}
      >
        <LineChart
          data={speedSeries}
          height={170}
          series={[
            { key: 'rx', label: '下行', color: '#06b6d4', get: (d) => d.rx, fmt: (v) => fmtSpeed(v) },
            { key: 'tx', label: '上行', color: '#10b981', get: (d) => d.tx, fmt: (v) => fmtSpeed(v) },
          ]}
        />
      </Card>

      {/* 蜂窝 + 设备 */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="蜂窝详情" icon={<SignalIcon size={15} />}>
          {sig ? (
            <dl className="divide-y divide-slate-100 dark:divide-white/5">
              <KV k="运营商" v={`${sig.op.provider || '--'} · ${sig.displayType}`} />
              {sig.nr.rsrp != null && (
                <>
                  <KV k="NR 频段" v={sig.nr.band || '--'} />
                  <KV
                    k="NR RSRP / RSRQ / SINR"
                    v={`${sig.nr.rsrp?.toFixed(0)} / ${sig.nr.rsrq?.toFixed(0) ?? '--'} / ${sig.nr.sinr?.toFixed(0) ?? '--'} dBm`}
                  />
                </>
              )}
              {sig.lte.rsrp != null && (
                <>
                  <KV k="LTE 频段" v={sig.lte.band || '--'} />
                  <KV
                    k="LTE RSRP / RSRQ / SINR"
                    v={`${sig.lte.rsrp?.toFixed(0)} / ${sig.lte.rsrq?.toFixed(0) ?? '--'} / ${sig.lte.sinr?.toFixed(0) ?? '--'} dBm`}
                  />
                </>
              )}
              <KV k="信号评级" v={<span className={level.color}>{rsrp != null ? `${rsrp.toFixed(0)} dBm · ${level.label}` : '--'}</span>} />
              <KV k="PCI / 小区" v={`${sig.nr.pci || sig.lte.pci || '--'} / ${sig.nr.cellID || sig.lte.cellID || '--'}`} />
            </dl>
          ) : (
            <div className="py-4 text-center text-sm text-slate-400">等待信号数据…</div>
          )}
        </Card>

        <Card title="设备信息" icon={<Cpu size={15} />}>
          <dl className="divide-y divide-slate-100 dark:divide-white/5">
            <KV k="主机名" v={st.device?.hostname} />
            <KV k="运行时间" v={fmtUptime(num(st.device?.uptime_secs))} />
            <KV k="负载 (1/5/15)" v={st.device?.load_avg?.map((l: number) => l.toFixed(2)).join('  ')} />
            <KV k="内存" v={st.memory ? `${fmtBytes(num0(st.memory.used_kb) * 1024)} / ${fmtBytes(num0(st.memory.total_kb) * 1024)}` : '--'} />
            <KV k="电池电压/温度" v={st.battery ? `${(num0(st.battery.battery_voltage ?? st.battery.voltage_mv) / (num(st.battery.battery_voltage) ? 1000 : 1)).toFixed(2)}V · ${num(st.battery.battery_temperature)?.toFixed(1) ?? '--'}°C` : '--'} />
            <KV k="内核" v={<span className="font-mono text-[11px]">{String(st.device?.kernel ?? '--').split(' ').slice(0, 3).join(' ')}</span>} />
          </dl>
          {st.cpu && st.cpu.cores.length > 0 && (
            <div className="mt-3 grid grid-cols-4 gap-1.5">
              {st.cpu.cores.map((c, i) => (
                <div key={i} className="rounded-lg bg-slate-100 px-2 py-1 text-center dark:bg-white/5">
                  <div className="text-[10px] text-slate-400">核{i}</div>
                  <div className="tabular text-xs font-semibold">{c.toFixed(0)}%</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* 流量 + WiFi */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="流量统计" icon={<DatabaseZap size={15} />}>
          <div className="grid grid-cols-3 gap-3 text-center">
            {[
              { label: '今日', d: st.usage?.day },
              { label: '本月', d: st.usage?.month },
              { label: '总计', d: st.usage?.total },
            ].map(({ label, d }) => (
              <div key={label} className="rounded-xl bg-slate-50 p-3 dark:bg-white/5">
                <div className="text-xs text-slate-400">{label}</div>
                <div className="tabular mt-1 text-sm font-bold text-slate-800 dark:text-slate-100">
                  {d ? fmtBytes(num0(d.rx_bytes) + num0(d.tx_bytes)) : '--'}
                </div>
                <div className="tabular mt-1 text-[10px] text-slate-400">
                  ↓{d ? fmtBytes(num0(d.rx_bytes)) : '--'} ↑{d ? fmtBytes(num0(d.tx_bytes)) : '--'}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="WiFi" icon={<Wifi size={15} />}>
          <dl className="divide-y divide-slate-100 dark:divide-white/5">
            <KV k="2.4G SSID" v={st.wifi?.ssid_2g || '--'} />
            <KV k="5G SSID" v={st.wifi?.ssid_5g || '--'} />
            <KV
              k="已连接设备"
              v={`2.4G: ${st.wifi?.clients_2g ?? '--'} · 5G: ${st.wifi?.clients_5g ?? '--'}`}
            />
            <KV k="WiFi 开关" v={st.wifi ? (String(st.wifi.wifi_onoff) === '1' ? <Badge tone="green">开启</Badge> : <Badge tone="red">关闭</Badge>) : '--'} />
          </dl>
        </Card>
      </div>

      {/* 客户端 + 进程 */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card
          title="已连接设备"
          icon={<Users size={15} />}
          extra={<Badge tone="brand">{clients.length} 台</Badge>}
        >
          {clients.length === 0 ? (
            <div className="py-4 text-center text-sm text-slate-400">暂无客户端</div>
          ) : (
            <div className="max-h-56 overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-400">
                    <th className="pb-2 font-medium">设备</th>
                    <th className="pb-2 font-medium">IP</th>
                    <th className="hidden pb-2 font-medium sm:table-cell">MAC</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                  {clients.map((c) => (
                    <tr key={c.mac}>
                      <td className="max-w-0 truncate py-2 pr-2 font-medium">{c.name}</td>
                      <td className="tabular py-2 pr-2 text-slate-500 dark:text-slate-400">{c.ip}</td>
                      <td className="tabular hidden py-2 font-mono text-xs text-slate-400 sm:table-cell">{c.mac}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card
          title="进程 Top 5"
          icon={<MemoryStick size={15} />}
          extra={
            <Button size="sm" variant="danger" icon={<Trash2 size={13} />} loading={killing} onClick={killBloat}>
              清理冗余进程{st.top ? ` (${st.top.bloat_count})` : ''}
            </Button>
          }
        >
          {!st.top ? (
            <div className="py-4 text-center text-sm text-slate-400">加载中…</div>
          ) : (
            <>
              {st.top.bloat_count > 0 && (
                <p className="mb-2 text-xs text-amber-500">
                  发现 {st.top.bloat_count} 个冗余守护进程，占用 {fmtBytes(num0(st.top.bloat_rss_kb) * 1024)} 内存
                </p>
              )}
              <div className="space-y-1.5">
                {(st.top.processes ?? []).slice(0, 5).map((p: any) => (
                  <div key={p.pid} className="flex items-center gap-2 text-sm">
                    <span className="tabular w-14 shrink-0 font-mono text-xs text-slate-400">{p.pid}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {p.name}
                      {p.is_bloat && <Badge tone="yellow">冗余</Badge>}
                    </span>
                    <span className="tabular w-14 text-right text-xs">{p.cpu_pct.toFixed(1)}%</span>
                    <span className="tabular w-16 text-right text-xs text-slate-400">{fmtBytes(p.rss_kb * 1024)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  )
}
