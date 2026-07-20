import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Antenna,
  RadioTower,
  Radar,
  Zap,
  Play,
  Square,
  RotateCcw,
  Search,
  Lock,
  LockOpen,
} from 'lucide-react'
import { api, fetchAll } from '../lib/api'
import { useAsync, usePoll } from '../lib/hooks'
import { num, rsrpLevel } from '../lib/format'
import {
  PageHeader,
  Tabs,
  Card,
  Badge,
  Button,
  Field,
  Input,
  Toggle,
  Progress,
  ConfirmModal,
  Spinner,
  ErrorBox,
  EmptyState,
  KV,
  toast,
} from '../components/ui'

/* ---------- 工具 ---------- */

function str(v: unknown): string {
  return v == null ? '' : String(v)
}

function truthy(v: unknown): boolean {
  if (typeof v === 'string') return v === '1' || v.toLowerCase() === 'true' || v.toLowerCase() === 'on'
  if (typeof v === 'number') return v !== 0
  return v === true
}

/* ---------- 频段清单（移植自 iOS BandModels / BandSpecDatabase） ---------- */

const NR_BANDS: [string, string][] = [
  ['1', '2100M'], ['2', '1900M'], ['3', '1800M'], ['5', '850M'], ['7', '2600M'], ['8', '900M'],
  ['12', '700M'], ['20', '800M'], ['25', '1900M'], ['28', '700M'], ['38', '2600M'], ['40', '2300M'],
  ['41', '2500M'], ['48', '3.5G'], ['66', 'AWS-3'], ['71', '600M'], ['77', '3.7G'], ['78', '3.5G'],
  ['79', '4.7G'],
]

const LTE_BANDS: [string, string][] = [
  ['1', '2100M'], ['2', '1900M'], ['3', '1800M'], ['4', 'AWS'], ['5', '850M'], ['7', '2600M'],
  ['8', '900M'], ['12', '700M'], ['13', '700M'], ['14', '700M'], ['17', '700M'], ['20', '800M'],
  ['25', '1900M'], ['26', '850M'], ['28', '700M'], ['29', '700M'], ['30', '2300M'], ['32', '1500M'],
  ['38', '2600M'], ['39', '1900M'], ['40', '2300M'], ['41', '2500M'], ['42', '3.5G'], ['43', '3.7G'],
  ['46', '5.2G'], ['48', '3.5G'], ['66', 'AWS-3'], ['71', '600M'],
]

function BandGrid({
  bands,
  prefix,
  selected,
  onToggle,
}: {
  bands: [string, string][]
  prefix: string
  selected: Set<string>
  onToggle: (b: string) => void
}) {
  return (
    <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-7">
      {bands.map(([b, freq]) => {
        const on = selected.has(b)
        return (
          <button
            key={b}
            type="button"
            onClick={() => onToggle(b)}
            className={`rounded-lg border px-1 py-1.5 text-center transition-colors ${
              on
                ? 'border-brand-500 bg-brand-600 text-white shadow-sm'
                : 'border-slate-200/80 bg-slate-50 text-slate-600 hover:border-brand-400 dark:border-white/10 dark:bg-white/5 dark:text-slate-300'
            }`}
          >
            <div className="tabular text-xs font-bold">
              {prefix}
              {b}
            </div>
            <div className={`text-[9px] leading-tight ${on ? 'text-white/70' : 'text-slate-400'}`}>{freq}</div>
          </button>
        )
      })}
    </div>
  )
}

function toggleIn(set: Set<string>, b: string): Set<string> {
  const next = new Set(set)
  if (next.has(b)) next.delete(b)
  else next.add(b)
  return next
}

function sortedStr(set: Set<string>): string {
  return [...set].sort((a, b) => Number(a) - Number(b)).join(',')
}

function BandLockSection() {
  const [nrSel, setNrSel] = useState<Set<string>>(new Set())
  const [lteSel, setLteSel] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<'nr' | 'lte' | 'reset' | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)

  const applyNr = async () => {
    if (nrSel.size === 0) {
      toast.error('请至少选择一个 NR 频段')
      return
    }
    const bandStr = sortedStr(nrSel)
    setBusy('nr')
    try {
      // 固件要求 NSA / SA 分别下发（同 iOS 实现）
      await api.post('/api/cell/band/nr', { nr5g_type: 'nsa', nr5g_band: bandStr })
      await api.post('/api/cell/band/nr', { nr5g_type: 'sa', nr5g_band: bandStr })
      toast.success(`NR 频段已锁定：n${bandStr.replace(/,/g, ' / n')}`)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(null)
    }
  }

  const applyLte = async () => {
    if (lteSel.size === 0) {
      toast.error('请至少选择一个 LTE 频段')
      return
    }
    const bandStr = sortedStr(lteSel)
    setBusy('lte')
    try {
      await api.post('/api/cell/band/lte', {
        is_lte_band: '1',
        lte_band_mask: bandStr,
        is_gw_band: '0',
        gw_band_mask: '',
      })
      toast.success(`LTE 频段已锁定：B${bandStr.replace(/,/g, ' / B')}`)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(null)
    }
  }

  const doReset = async () => {
    setBusy('reset')
    try {
      await api.post('/api/cell/band/reset')
      setNrSel(new Set())
      setLteSel(new Set())
      setConfirmReset(false)
      toast.success('频段锁已重置，恢复全部频段')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-3">
      <Card
        title="NR（5G）频段"
        icon={<Antenna size={15} />}
        extra={
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setNrSel(new Set(NR_BANDS.map(([b]) => b)))}>
              全选
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setNrSel(new Set())}>
              清空
            </Button>
            <Button size="sm" loading={busy === 'nr'} onClick={applyNr}>
              锁定 NR 频段
            </Button>
          </div>
        }
      >
        <BandGrid bands={NR_BANDS} prefix="n" selected={nrSel} onToggle={(b) => setNrSel((s) => toggleIn(s, b))} />
        <p className="mt-2 text-xs text-slate-400">锁定时会同时应用到 NSA 与 SA 模式。</p>
      </Card>

      <Card
        title="LTE（4G）频段"
        icon={<Antenna size={15} />}
        extra={
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setLteSel(new Set(LTE_BANDS.map(([b]) => b)))}>
              全选
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setLteSel(new Set())}>
              清空
            </Button>
            <Button size="sm" loading={busy === 'lte'} onClick={applyLte}>
              锁定 LTE 频段
            </Button>
          </div>
        }
      >
        <BandGrid bands={LTE_BANDS} prefix="B" selected={lteSel} onToggle={(b) => setLteSel((s) => toggleIn(s, b))} />
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            锁定后调制解调器只会在所选频段上搜网；如需恢复全部频段，请重置。
          </p>
          <Button variant="danger" icon={<RotateCcw size={13} />} onClick={() => setConfirmReset(true)}>
            重置频段
          </Button>
        </div>
      </Card>

      <ConfirmModal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={doReset}
        loading={busy === 'reset'}
        title="重置频段锁"
        danger
        confirmText="重置"
        message="将清除所有 NR / LTE 频段锁定，恢复为自动使用全部频段。期间网络会重新注册，确定重置吗？"
      />
    </div>
  )
}

/* ---------- 小区锁 ---------- */

interface Neighbor {
  type: 'NR' | 'LTE'
  pci: string
  earfcn: string
  band: string
  rsrp: string
}

function CellLockSection() {
  const { data: sig, refresh } = useAsync(() => api.get('/api/network/signal'))
  const [nrPci, setNrPci] = useState('')
  const [nrArfcn, setNrArfcn] = useState('')
  const [nrBand, setNrBand] = useState('')
  const [ltePci, setLtePci] = useState('')
  const [lteEarfcn, setLteEarfcn] = useState('')
  const [busy, setBusy] = useState<'nr' | 'lte' | 'reset' | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [nbrs, setNbrs] = useState<Neighbor[] | null>(null)
  const scanAttempts = useRef(0)

  const cur = {
    nrPci: str(sig?.nr_pci) || str(sig?.nr5g_pci),
    nrArfcn: str(sig?.nr_earfcn) || str(sig?.nr5g_earfcn) || str(sig?.nr5g_action_channel),
    nrBand: str(sig?.nr_band) || str(sig?.nr5g_band) || str(sig?.nr5g_action_band),
    ltePci: str(sig?.lte_pci),
    lteEarfcn: str(sig?.lte_earfcn) || str(sig?.wan_active_channel),
    lteBand: str(sig?.lte_band) || str(sig?.wan_active_band),
  }

  const lockNr = async () => {
    if (!nrPci.trim() || !nrArfcn.trim()) {
      toast.error('请输入 PCI 和 ARFCN')
      return
    }
    setBusy('nr')
    try {
      const body: Record<string, string> = { pci: nrPci.trim(), earfcn: nrArfcn.trim() }
      if (nrBand.trim()) body.band = nrBand.trim()
      await api.post('/api/cell/lock/nr', body)
      toast.success('NR 小区锁已下发')
      setTimeout(() => refresh(), 3000)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(null)
    }
  }

  const lockLte = async () => {
    if (!ltePci.trim() || !lteEarfcn.trim()) {
      toast.error('请输入 PCI 和 EARFCN')
      return
    }
    setBusy('lte')
    try {
      await api.post('/api/cell/lock/lte', { pci: ltePci.trim(), earfcn: lteEarfcn.trim() })
      toast.success('LTE 小区锁已下发')
      setTimeout(() => refresh(), 3000)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(null)
    }
  }

  const doReset = async () => {
    setBusy('reset')
    try {
      await api.post('/api/cell/lock/reset')
      setConfirmReset(false)
      toast.success('小区锁已重置')
      setTimeout(() => refresh(), 3000)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(null)
    }
  }

  const scanNeighbors = async () => {
    setScanning(true)
    setNbrs(null)
    scanAttempts.current = 0
    try {
      await api.post('/api/cell/neighbors/scan')
      toast.info('正在扫描邻区，约需 5~15 秒…')
    } catch (e: any) {
      toast.error(e.message)
      setScanning(false)
    }
  }

  // 轮询邻区结果
  usePoll(
    async () => {
      scanAttempts.current += 1
      const r = await fetchAll({
        nr: () => api.get('/api/cell/neighbors/nr'),
        lte: () => api.get('/api/cell/neighbors/lte'),
      })
      const out: Neighbor[] = []
      const collect = (raw: any, type: 'NR' | 'LTE') => {
        const list = Array.isArray(raw?.cell_list) ? raw.cell_list : []
        for (const c of list) {
          out.push({
            type,
            pci: str(c?.pci),
            earfcn: str(c?.earfcn),
            band: str(c?.band),
            rsrp: str(c?.rsrp),
          })
        }
      }
      if (r.nr) collect(r.nr, 'NR')
      if (r.lte) collect(r.lte, 'LTE')
      if (out.length > 0) {
        setNbrs(out)
        setScanning(false)
        toast.success(`发现 ${out.length} 个邻区`)
      } else if (scanAttempts.current >= 6) {
        setScanning(false)
        setNbrs([])
        toast.info('未发现邻区，可稍后重新扫描')
      }
    },
    3000,
    scanning,
  )

  const fillLock = (n: Neighbor) => {
    if (n.type === 'NR') {
      setNrPci(n.pci)
      setNrArfcn(n.earfcn)
      setNrBand(n.band.replace(/^n/i, ''))
      toast.info('已填入 NR 锁定表单')
    } else {
      setLtePci(n.pci)
      setLteEarfcn(n.earfcn)
      toast.info('已填入 LTE 锁定表单')
    }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="space-y-3">
      <Card title="当前小区" icon={<RadioTower size={15} />}>
        <dl className="grid gap-x-6 divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0 dark:divide-white/5">
          <div className="divide-y divide-slate-100 dark:divide-white/5">
            <KV k="NR PCI / ARFCN" v={`${cur.nrPci || '--'} / ${cur.nrArfcn || '--'}`} mono />
            <KV k="NR 频段" v={cur.nrBand ? `n${cur.nrBand.replace(/^n/i, '')}` : '--'} />
          </div>
          <div className="divide-y divide-slate-100 dark:divide-white/5">
            <KV k="LTE PCI / EARFCN" v={`${cur.ltePci || '--'} / ${cur.lteEarfcn || '--'}`} mono />
            <KV k="LTE 频段" v={cur.lteBand ? `B${cur.lteBand.replace(/^b/i, '')}` : '--'} />
          </div>
        </dl>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="NR 小区锁" icon={<Lock size={15} />}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="PCI">
                <Input
                  value={nrPci}
                  onChange={(e) => setNrPci(e.target.value)}
                  placeholder="如 321"
                  inputMode="numeric"
                  className="tabular font-mono"
                />
              </Field>
              <Field label="ARFCN">
                <Input
                  value={nrArfcn}
                  onChange={(e) => setNrArfcn(e.target.value)}
                  placeholder="如 627264"
                  inputMode="numeric"
                  className="tabular font-mono"
                />
              </Field>
            </div>
            <Field label="频段（可选）" hint="仅填数字，如 78 表示 n78">
              <Input
                value={nrBand}
                onChange={(e) => setNrBand(e.target.value)}
                placeholder="如 78"
                inputMode="numeric"
                className="tabular font-mono"
              />
            </Field>
            <Button icon={<Lock size={13} />} loading={busy === 'nr'} onClick={lockNr}>
              锁定 NR 小区
            </Button>
          </div>
        </Card>

        <Card title="LTE 小区锁" icon={<Lock size={15} />}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="PCI">
                <Input
                  value={ltePci}
                  onChange={(e) => setLtePci(e.target.value)}
                  placeholder="如 128"
                  inputMode="numeric"
                  className="tabular font-mono"
                />
              </Field>
              <Field label="EARFCN">
                <Input
                  value={lteEarfcn}
                  onChange={(e) => setLteEarfcn(e.target.value)}
                  placeholder="如 1650"
                  inputMode="numeric"
                  className="tabular font-mono"
                />
              </Field>
            </div>
            <div className="flex gap-2">
              <Button icon={<Lock size={13} />} loading={busy === 'lte'} onClick={lockLte}>
                锁定 LTE 小区
              </Button>
              <Button variant="danger" icon={<LockOpen size={13} />} onClick={() => setConfirmReset(true)}>
                重置小区锁
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <Card
        title="邻区扫描"
        icon={<Search size={15} />}
        extra={
          <Button size="sm" icon={<Search size={13} />} loading={scanning} onClick={scanNeighbors}>
            {nbrs ? '重新扫描' : '扫描邻区'}
          </Button>
        }
      >
        {scanning && <Spinner text="正在扫描邻区…" />}
        {!scanning && nbrs == null && (
          <EmptyState icon={<Search size={22} />} text="扫描后可将信号好的邻区一键填入锁定表单" />
        )}
        {!scanning && nbrs != null && nbrs.length === 0 && <EmptyState text="未发现邻区" />}
        {!scanning && nbrs != null && nbrs.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400">
                  <th className="pb-2 font-medium">类型</th>
                  <th className="pb-2 font-medium">PCI</th>
                  <th className="pb-2 font-medium">频段</th>
                  <th className="pb-2 font-medium">ARFCN / EARFCN</th>
                  <th className="pb-2 font-medium">RSRP</th>
                  <th className="pb-2 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {nbrs.map((n, i) => {
                  const lv = rsrpLevel(num(n.rsrp))
                  return (
                    <tr key={`${n.type}-${n.pci}-${n.earfcn}-${i}`}>
                      <td className="py-2 pr-2">
                        <Badge tone={n.type === 'NR' ? 'brand' : 'blue'}>{n.type}</Badge>
                      </td>
                      <td className="tabular py-2 pr-2 font-mono text-[13px]">{n.pci || '--'}</td>
                      <td className="tabular py-2 pr-2">{n.band || '--'}</td>
                      <td className="tabular py-2 pr-2 font-mono text-[13px]">{n.earfcn || '--'}</td>
                      <td className={`tabular py-2 pr-2 font-medium ${lv.color}`}>
                        {n.rsrp ? `${n.rsrp} dBm` : '--'}
                      </td>
                      <td className="py-2 text-right">
                        <Button size="sm" variant="secondary" onClick={() => fillLock(n)}>
                          锁定
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmModal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={doReset}
        loading={busy === 'reset'}
        title="重置小区锁"
        danger
        confirmText="重置"
        message="将清除 NR / LTE 小区锁定，恢复自动选择小区。期间网络会重新注册，确定重置吗？"
      />
    </div>
  )
}

/* ---------- 信号检测 ---------- */

interface DetectResult {
  type: string
  band: string
  earfcn: string
  pci: string
  rsrp: string
  rsrq: string
  sinr: string
}

function SignalDetectSection() {
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [results, setResults] = useState<DetectResult[] | null>(null)
  const [busy, setBusy] = useState(false)

  const fetchResults = useCallback(async () => {
    try {
      const r = await api.get('/api/cell/signal-detect/results')
      const list = Array.isArray(r?.record_list) ? r.record_list : []
      const parsed: DetectResult[] = list.map((it: any) => ({
        type: str(it?.type) || '--',
        band: str(it?.band),
        earfcn: str(it?.earfcn),
        pci: str(it?.pci),
        rsrp: str(it?.rsrp),
        rsrq: str(it?.rsrq),
        sinr: str(it?.sinr),
      }))
      parsed.sort((a, b) => (num(b.rsrp) ?? -999) - (num(a.rsrp) ?? -999))
      setResults(parsed)
    } catch {
      /* 结果可能尚未生成 */
    }
  }, [])

  const start = async () => {
    setBusy(true)
    try {
      await api.post('/api/cell/signal-detect/start')
      setRunning(true)
      setProgress(0)
      setResults(null)
      toast.info('信号检测已开始，将遍历可用频段评估信号质量')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  const stop = async () => {
    setBusy(true)
    try {
      await api.post('/api/cell/signal-detect/stop')
      setRunning(false)
      toast.success('检测已停止')
      await fetchResults()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  // 轮询进度
  usePoll(
    async () => {
      try {
        const r = await api.get('/api/cell/signal-detect/progress')
        const p = num(r?.progress) ?? 0
        setProgress(p)
        if (p >= 100) {
          setRunning(false)
          await fetchResults()
          toast.success('信号检测完成')
        }
      } catch {
        /* 轮询错误静默 */
      }
    },
    2000,
    running,
  )

  return (
    <div className="space-y-3">
      <Card title="信号质量检测" icon={<Radar size={15} />}>
        {running ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500 dark:text-slate-400">检测进度</span>
              <span className="tabular font-semibold text-brand-500">{progress}%</span>
            </div>
            <Progress value={progress} />
            <p className="text-xs text-slate-400">检测期间设备会临时切换频段，网络可能短暂波动。</p>
            <Button variant="danger" icon={<Square size={13} />} loading={busy} onClick={stop}>
              停止检测
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              遍历扫描各频段小区，评估信号质量并给出最优小区建议。
            </p>
            <Button icon={<Play size={13} />} loading={busy} onClick={start}>
              开始检测
            </Button>
          </div>
        )}
      </Card>

      {results != null && (
        <Card
          title="检测结果"
          icon={<Radar size={15} />}
          extra={results.length > 0 ? <Badge tone="brand">{results.length} 个小区</Badge> : undefined}
        >
          {results.length === 0 ? (
            <EmptyState text="暂无检测结果" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-400">
                    <th className="pb-2 font-medium">类型</th>
                    <th className="pb-2 font-medium">频段</th>
                    <th className="pb-2 font-medium">PCI</th>
                    <th className="pb-2 font-medium">ARFCN / EARFCN</th>
                    <th className="pb-2 font-medium">RSRP</th>
                    <th className="pb-2 font-medium">RSRQ</th>
                    <th className="pb-2 font-medium">SINR</th>
                    <th className="pb-2 font-medium">建议</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                  {results.map((r, i) => {
                    const lv = rsrpLevel(num(r.rsrp))
                    return (
                      <tr key={`${r.type}-${r.pci}-${r.earfcn}-${i}`}>
                        <td className="py-2 pr-2">
                          <Badge tone={r.type.toUpperCase().includes('NR') || r.type.includes('5G') ? 'brand' : 'blue'}>
                            {r.type}
                          </Badge>
                        </td>
                        <td className="tabular py-2 pr-2">{r.band || '--'}</td>
                        <td className="tabular py-2 pr-2 font-mono text-[13px]">{r.pci || '--'}</td>
                        <td className="tabular py-2 pr-2 font-mono text-[13px]">{r.earfcn || '--'}</td>
                        <td className={`tabular py-2 pr-2 font-medium ${lv.color}`}>
                          {r.rsrp ? `${r.rsrp} dBm` : '--'}
                        </td>
                        <td className="tabular py-2 pr-2">{r.rsrq ? `${r.rsrq} dB` : '--'}</td>
                        <td className="tabular py-2 pr-2">{r.sinr ? `${r.sinr} dB` : '--'}</td>
                        <td className="py-2">{i === 0 ? <Badge tone="green">最优</Badge> : ''}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}

/* ---------- STC 智能基站连接 ---------- */

function StcSection() {
  const { data, error, loading, refresh } = useAsync(() =>
    fetchAll({
      params: () => api.get('/api/cell/stc/params'),
      status: () => api.get('/api/cell/stc/status'),
    }),
  )
  const [form, setForm] = useState({ lteTimer: '', nrsaTimer: '', lteMax: '', nrsaMax: '' })
  const [formInit, setFormInit] = useState(false)
  const [busy, setBusy] = useState<'save' | 'toggle' | 'reset' | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)

  const enabled =
    truthy(data?.status?.stc_enable) || truthy(data?.status?.status) || truthy(data?.params?.stc_enable)

  useEffect(() => {
    if (data?.params && !formInit) {
      setForm({
        lteTimer: str(data.params.lte_collect_timer),
        nrsaTimer: str(data.params.nrsa_collect_timer),
        lteMax: str(data.params.lte_whitelist_max),
        nrsaMax: str(data.params.nrsa_whitelist_max),
      })
      setFormInit(true)
    }
  }, [data, formInit])

  const toggle = async (v: boolean) => {
    setBusy('toggle')
    try {
      await api.post(v ? '/api/cell/stc/enable' : '/api/cell/stc/disable')
      toast.success(v ? 'STC 已启用' : 'STC 已禁用')
      await refresh()
    } catch (e: any) {
      toast.error(e.message)
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  const save = async () => {
    setBusy('save')
    try {
      await api.put('/api/cell/stc/params', {
        lte_collect_timer: form.lteTimer,
        nrsa_collect_timer: form.nrsaTimer,
        lte_whitelist_max: form.lteMax,
        nrsa_whitelist_max: form.nrsaMax,
      })
      toast.success('STC 参数已保存')
      await refresh()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(null)
    }
  }

  const doReset = async () => {
    setBusy('reset')
    try {
      await api.post('/api/cell/stc/reset')
      setConfirmReset(false)
      toast.success('STC 白名单已重置')
      await refresh()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(null)
    }
  }

  if (loading && !data) return <Spinner />
  if (error && !data) return <ErrorBox error={error} onRetry={refresh} />

  return (
    <div className="space-y-3">
      <Card title="STC 状态" icon={<Zap size={15} />}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-500 dark:text-slate-400">智能基站连接</span>
            {enabled ? <Badge tone="green">已启用</Badge> : <Badge>已禁用</Badge>}
          </div>
          <div className="flex items-center gap-2">
            <Toggle checked={enabled} loading={busy === 'toggle'} onChange={toggle} />
            <Button variant="danger" size="sm" icon={<RotateCcw size={12} />} onClick={() => setConfirmReset(true)}>
              重置白名单
            </Button>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          STC 会根据历史信号质量自动维护优质基站白名单，优先连接信号更好的小区。
        </p>
      </Card>

      <Card title="采集参数" icon={<Zap size={15} />}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="LTE 采集计时器">
            <Input
              value={form.lteTimer}
              onChange={(e) => setForm({ ...form, lteTimer: e.target.value })}
              inputMode="numeric"
              className="tabular font-mono"
            />
          </Field>
          <Field label="NR SA 采集计时器">
            <Input
              value={form.nrsaTimer}
              onChange={(e) => setForm({ ...form, nrsaTimer: e.target.value })}
              inputMode="numeric"
              className="tabular font-mono"
            />
          </Field>
          <Field label="LTE 白名单上限">
            <Input
              value={form.lteMax}
              onChange={(e) => setForm({ ...form, lteMax: e.target.value })}
              inputMode="numeric"
              className="tabular font-mono"
            />
          </Field>
          <Field label="NR SA 白名单上限">
            <Input
              value={form.nrsaMax}
              onChange={(e) => setForm({ ...form, nrsaMax: e.target.value })}
              inputMode="numeric"
              className="tabular font-mono"
            />
          </Field>
        </div>
        <div className="mt-3">
          <Button loading={busy === 'save'} onClick={save}>
            保存参数
          </Button>
        </div>
      </Card>

      <ConfirmModal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={doReset}
        loading={busy === 'reset'}
        title="重置 STC 白名单"
        danger
        confirmText="重置"
        message="将清空 STC 已学习的优质基站白名单并禁用 STC，设备恢复默认小区选择策略。确定重置吗？"
      />
    </div>
  )
}

/* ---------- 页面 ---------- */

export default function Cells() {
  const [tab, setTab] = useState('band')
  return (
    <div className="space-y-4">
      <PageHeader title="频段与小区" desc="频段锁、小区锁、信号检测与 STC 智能基站连接" />
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'band', label: '频段锁', icon: <Antenna size={14} /> },
          { key: 'cell', label: '小区锁', icon: <RadioTower size={14} /> },
          { key: 'detect', label: '信号检测', icon: <Radar size={14} /> },
          { key: 'stc', label: 'STC', icon: <Zap size={14} /> },
        ]}
      />
      {tab === 'band' && <BandLockSection />}
      {tab === 'cell' && <CellLockSection />}
      {tab === 'detect' && <SignalDetectSection />}
      {tab === 'stc' && <StcSection />}
    </div>
  )
}
