import { useState } from 'react'
import { Radio, Antenna, Activity, SignalHigh } from 'lucide-react'
import { api } from '../lib/api'
import { usePoll, useSeries } from '../lib/hooks'
import { rsrpLevel, fmtTime } from '../lib/format'
import { parseSignal, rsrpToBars, type ParsedSignal, type Carrier } from '../lib/signal'
import { Card, Badge, KV, PageHeader, Spinner, ErrorBox, EmptyState } from '../components/ui'
import { LineChart, SignalBars } from '../components/LineChart'

/** 历史曲线数据点 */
interface SigPoint {
  nr: number | null
  lte: number | null
  nrSinr: number | null
  lteSinr: number | null
  wcdma: number | null
}

/** SINR → 评级颜色（语义参考 iOS sinrColor） */
function sinrColor(v: number | null): string | undefined {
  if (v == null) return undefined
  if (v >= 20) return 'text-emerald-400'
  if (v >= 13) return 'text-green-400'
  if (v >= 5) return 'text-yellow-400'
  if (v >= 0) return 'text-orange-400'
  return 'text-red-400'
}

/** RSRQ → 评级颜色（语义参考 iOS rsrqColor） */
function rsrqColor(v: number | null): string | undefined {
  if (v == null) return undefined
  if (v >= -10) return 'text-emerald-400'
  if (v >= -15) return 'text-green-400'
  if (v >= -20) return 'text-yellow-400'
  return 'text-red-400'
}

/** 大数字信号指标块 */
function Metric({
  label,
  value,
  unit,
  color,
}: {
  label: string
  value: number | null
  unit: string
  color?: string
}) {
  return (
    <div className="rounded-xl bg-slate-50 px-2 py-2.5 text-center dark:bg-white/5">
      <div className="text-[10px] text-slate-400">{label}</div>
      <div
        className={`tabular text-xl font-bold leading-tight ${
          color ?? 'text-slate-800 dark:text-slate-100'
        }`}
      >
        {value != null ? Math.round(value) : '--'}
      </div>
      <div className="text-[10px] text-slate-400">{unit}</div>
    </div>
  )
}

/** SCC 辅载波块 */
function CarrierBlock({ c }: { c: Carrier }) {
  return (
    <div className="rounded-xl border border-slate-100 p-3 dark:border-white/5">
      <div className="tabular mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
        <span className="font-semibold text-slate-700 dark:text-slate-200">{c.label}</span>
        <span>B{c.band || '--'}</span>
        <span>PCI {c.pci || '--'}</span>
        <span>信道 {c.earfcn || '--'}</span>
        <span>带宽 {c.bandwidth || '--'}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="RSRP" value={c.rsrp} unit="dBm" color={rsrpLevel(c.rsrp).color} />
        <Metric label="RSRQ" value={c.rsrq} unit="dB" color={rsrqColor(c.rsrq)} />
        <Metric label="SINR" value={c.sinr} unit="dB" color={sinrColor(c.sinr)} />
        <Metric label="RSSI" value={c.rssi} unit="dBm" />
      </div>
    </div>
  )
}

export default function SignalPage() {
  const [sig, setSig] = useState<ParsedSignal | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const { series, push } = useSeries<SigPoint>(90)

  // 每 2 秒拉取一次信号
  usePoll(async () => {
    try {
      const raw = await api.get('/api/network/signal')
      const p = parseSignal(raw)
      setSig(p)
      setError(null)
      setUpdatedAt(Math.floor(Date.now() / 1000))
      push({
        nr: p.nr.rsrp,
        lte: p.lte.rsrp,
        nrSinr: p.nr.sinr,
        lteSinr: p.lte.sinr,
        wcdma: p.wcdma.rscp,
      })
    } catch (e: any) {
      if (!sig) setError(e?.message || '加载失败')
    }
  }, 2000)

  const level = rsrpLevel(sig?.bestRsrp)

  // 面板可见性（对齐 iOS showNR / showLTE / show3G 语义）
  const nrConnected = !!sig && (sig.nr.rsrp != null || sig.nr.scc.some((c) => c.rsrp != null))
  const lteConnected = !!sig && (sig.lte.rsrp != null || sig.lte.scc.some((c) => c.rsrp != null))
  const showNR = nrConnected || (!!sig && !!sig.nr.band)
  const showLTE = lteConnected || (!!sig && !!sig.lte.band)
  const show3G = !!sig && !showNR && !showLTE && (sig.wcdma.rscp != null || sig.wcdma.ecio != null)

  const lteCaActive =
    !!sig && sig.lte.caState !== '' && sig.lte.caState !== '0' && sig.lte.scc.length > 0

  return (
    <div className="space-y-4">
      <PageHeader
        title="信号监测"
        desc="蜂窝网络实时信号详情 · 每 2 秒刷新"
        extra={
          updatedAt && (
            <span className="tabular text-xs text-slate-400">更新于 {fmtTime(updatedAt)}</span>
          )
        }
      />

      {/* 顶部概览 */}
      <Card>
        {sig ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-4">
              <SignalBars level={rsrpToBars(sig.bestRsrp)} />
              <div>
                <div className="text-lg font-bold text-slate-800 dark:text-white">
                  {sig.op.provider || '未知运营商'}
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  <Badge tone={sig.displayType.includes('5G') ? 'brand' : 'blue'}>
                    {sig.displayType}
                  </Badge>
                  {sig.op.roaming && <Badge tone="yellow">漫游</Badge>}
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-400">最佳 RSRP</div>
              <div className={`tabular text-xl font-bold ${level.color}`}>
                {sig.bestRsrp != null ? `${sig.bestRsrp.toFixed(0)} dBm` : '--'}
              </div>
              <div className={`text-xs font-medium ${level.color}`}>{level.label}</div>
            </div>
          </div>
        ) : error ? (
          <ErrorBox error={error} />
        ) : (
          <Spinner text="等待信号数据…" />
        )}
      </Card>

      {/* 历史曲线 */}
      <Card
        title="信号历史曲线"
        icon={<Activity size={15} />}
        extra={<span className="text-xs text-slate-400">最近 3 分钟</span>}
      >
        {series.length < 2 ? (
          <EmptyState text="正在采集数据…" icon={<Activity size={20} />} />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <LineChart
              data={series}
              height={150}
              yMin={-125}
              yMax={-45}
              unit=" dBm"
              series={[
                { key: 'nr', label: 'NR RSRP', color: '#06b6d4', get: (d: SigPoint) => d.nr },
                { key: 'lte', label: 'LTE RSRP', color: '#f59e0b', get: (d: SigPoint) => d.lte },
              ]}
            />
            <LineChart
              data={series}
              height={150}
              unit=" dB"
              series={[
                { key: 'nrSinr', label: 'NR SINR', color: '#06b6d4', get: (d: SigPoint) => d.nrSinr },
                { key: 'lteSinr', label: 'LTE SINR', color: '#f59e0b', get: (d: SigPoint) => d.lteSinr },
              ]}
            />
          </div>
        )}
      </Card>

      {/* NR / LTE 面板 */}
      {(showNR || showLTE) && sig && (
        <div className="grid gap-3 lg:grid-cols-2">
          {showNR && (
            <Card
              title="5G NR"
              icon={<Antenna size={15} />}
              extra={
                <div className="flex items-center gap-1.5">
                  {sig.nr.scc.length > 0 && (
                    <Badge tone="brand">{1 + sig.nr.scc.length} CC</Badge>
                  )}
                  {nrConnected ? (
                    <span className={`text-xs font-semibold ${rsrpLevel(sig.nr.rsrp).color}`}>
                      {rsrpLevel(sig.nr.rsrp).label}
                    </span>
                  ) : (
                    <Badge>未连接</Badge>
                  )}
                </div>
              }
            >
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Metric label="RSRP" value={sig.nr.rsrp} unit="dBm" color={rsrpLevel(sig.nr.rsrp).color} />
                <Metric label="RSRQ" value={sig.nr.rsrq} unit="dB" color={rsrqColor(sig.nr.rsrq)} />
                <Metric label="SINR" value={sig.nr.sinr} unit="dB" color={sinrColor(sig.nr.sinr)} />
                <Metric label="RSSI" value={sig.nr.rssi} unit="dBm" />
              </div>
              <dl className="mt-3 divide-y divide-slate-100 dark:divide-white/5">
                <KV k="频段" v={sig.nr.band ? `n${sig.nr.band}` : '--'} />
                <KV k="PCI" v={sig.nr.pci || '--'} mono />
                <KV k="小区 ID" v={sig.nr.cellID || '--'} mono />
                <KV k="信道 (NRARFCN)" v={sig.nr.channel || '--'} mono />
                <KV k="带宽" v={sig.nr.bandwidth || '--'} />
                <KV
                  k="载波聚合"
                  v={
                    sig.nr.scc.length > 0
                      ? `已激活（${1 + sig.nr.scc.length} CC）`
                      : '未激活'
                  }
                />
              </dl>
              {sig.nr.scc.length > 0 && (
                <div className="mt-3 space-y-2">
                  {sig.nr.scc.map((c, i) => (
                    <CarrierBlock key={i} c={c} />
                  ))}
                </div>
              )}
            </Card>
          )}

          {showLTE && (
            <Card
              title="LTE"
              icon={<Radio size={15} />}
              extra={
                <div className="flex items-center gap-1.5">
                  {showNR && <Badge tone="yellow">NSA 锚点</Badge>}
                  {lteCaActive && <Badge tone="brand">{1 + sig.lte.scc.length} CC</Badge>}
                  {lteConnected ? (
                    <span className={`text-xs font-semibold ${rsrpLevel(sig.lte.rsrp).color}`}>
                      {rsrpLevel(sig.lte.rsrp).label}
                    </span>
                  ) : (
                    <Badge>未连接</Badge>
                  )}
                </div>
              }
            >
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Metric label="RSRP" value={sig.lte.rsrp} unit="dBm" color={rsrpLevel(sig.lte.rsrp).color} />
                <Metric label="RSRQ" value={sig.lte.rsrq} unit="dB" color={rsrqColor(sig.lte.rsrq)} />
                <Metric label="SINR" value={sig.lte.sinr} unit="dB" color={sinrColor(sig.lte.sinr)} />
                <Metric label="RSSI" value={sig.lte.rssi} unit="dBm" />
              </div>
              <dl className="mt-3 divide-y divide-slate-100 dark:divide-white/5">
                <KV k="频段" v={sig.lte.band ? `B${sig.lte.band}` : '--'} />
                <KV k="PCI" v={sig.lte.pci || '--'} mono />
                <KV k="小区 ID" v={sig.lte.cellID || '--'} mono />
                <KV k="信道 (EARFCN)" v={sig.lte.earfcn || '--'} mono />
                <KV k="带宽" v={sig.lte.bandwidth || '--'} />
                <KV
                  k="载波聚合"
                  v={
                    lteCaActive
                      ? `已激活（${1 + sig.lte.scc.length} CC）`
                      : sig.lte.scc.length > 0
                        ? `${1 + sig.lte.scc.length} CC`
                        : '未激活'
                  }
                />
              </dl>
              {sig.lte.scc.length > 0 && (
                <div className="mt-3 space-y-2">
                  {sig.lte.scc.map((c, i) => (
                    <CarrierBlock key={i} c={c} />
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>
      )}

      {/* WCDMA 面板（仅在无 NR/LTE 且有 3G 数据时） */}
      {show3G && sig && (
        <Card title="WCDMA" icon={<SignalHigh size={15} />}>
          <div className="grid grid-cols-2 gap-2 sm:max-w-md">
            <Metric label="RSCP" value={sig.wcdma.rscp} unit="dBm" color={rsrpLevel(sig.wcdma.rscp).color} />
            <Metric label="Ec/Io" value={sig.wcdma.ecio} unit="dB" color={sinrColor(sig.wcdma.ecio)} />
          </div>
        </Card>
      )}

      {/* 完全无信号 */}
      {sig && !showNR && !showLTE && !show3G && (
        <Card>
          <EmptyState text="暂无蜂窝信号数据" icon={<Antenna size={20} />} />
        </Card>
      )}
    </div>
  )
}
