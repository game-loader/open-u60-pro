import { useEffect, useRef, useState } from 'react'
import {
  Terminal,
  Gauge,
  ArrowDownUp,
  CalendarClock,
  ListOrdered,
  Send,
  Trash2,
  Plus,
  Pencil,
  RefreshCw,
  Play,
  Square,
  Eraser,
  AlertTriangle,
} from 'lucide-react'
import { api, getToken } from '../lib/api'
import { useAsync, usePolledData } from '../lib/hooks'
import { fmtBytes, fmtTime, num, num0 } from '../lib/format'
import {
  Card,
  Badge,
  Button,
  Input,
  Select,
  Toggle,
  Modal,
  ConfirmModal,
  Tabs,
  Progress,
  Spinner,
  ErrorBox,
  EmptyState,
  PageHeader,
  Field,
  toast,
} from '../components/ui'

/* ================= 通用 ================= */

function authHeaders(): Record<string, string> {
  const t = getToken()
  return t ? { Authorization: `Bearer ${t}` } : {}
}

/** 结果统计盒（延迟 / 下行 / 上行） */
function ResultBox({
  label,
  value,
  unit,
  sub,
  tone = 'default',
}: {
  label: string
  value: string
  unit: string
  sub?: string
  tone?: 'default' | 'brand' | 'green'
}) {
  const tones = {
    default: 'text-slate-800 dark:text-slate-100',
    brand: 'text-brand-500',
    green: 'text-emerald-500',
  }
  return (
    <div className="rounded-xl bg-slate-50 p-3 text-center dark:bg-white/5">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`tabular mt-1 text-lg font-bold leading-tight ${tones[tone]}`}>
        {value}
        <span className="ml-0.5 text-xs font-medium text-slate-400">{unit}</span>
      </div>
      <div className="tabular mt-0.5 text-[10px] text-slate-400">{sub ?? ' '}</div>
    </div>
  )
}

/* ================= 1. AT 终端 ================= */

interface AtEntry {
  id: number
  command: string
  response: string
  isError: boolean
  elapsedMs: number | null
  port: string
  time: number // unix 秒
}

const QUICK_AT = ['AT', 'ATI', 'AT+CSQ', 'AT+COPS?', 'AT+CPIN?', 'AT+CGSN', 'AT+CGDCONT?']

function AtTerminal() {
  const port = useAsync<{ port: string | null; available: boolean }>(() => api.get('/api/at/port'))
  const [cmd, setCmd] = useState('')
  const [timeoutSec, setTimeoutSec] = useState(5)
  const [sending, setSending] = useState(false)
  const [history, setHistory] = useState<AtEntry[]>([])
  const idRef = useRef(0)

  const pushEntry = (e: Omit<AtEntry, 'id'>) =>
    setHistory((h) => [{ ...e, id: ++idRef.current }, ...h].slice(0, 50))

  const send = async (raw?: string) => {
    const command = (raw ?? cmd).trim()
    if (!command || sending) return
    setSending(true)
    try {
      const r = await api.post('/api/at/send', { command, timeout: timeoutSec })
      pushEntry({
        command: r.command ?? command,
        response: r.response || '(无响应)',
        isError: false,
        elapsedMs: num(r.elapsed_ms),
        port: r.port ?? '',
        time: Math.floor(Date.now() / 1000),
      })
      setCmd('')
    } catch (e: any) {
      toast.error(e.message)
      pushEntry({
        command,
        response: e.message,
        isError: true,
        elapsedMs: null,
        port: '',
        time: Math.floor(Date.now() / 1000),
      })
    } finally {
      setSending(false)
    }
  }

  return (
    <Card
      title="AT 终端"
      icon={<Terminal size={15} />}
      extra={
        <div className="flex items-center gap-2">
          {port.data ? (
            <Badge tone={port.data.available ? 'green' : 'red'}>
              <span className="font-mono">{port.data.available ? port.data.port : '端口不可用'}</span>
            </Badge>
          ) : (
            <Badge>检测中…</Badge>
          )}
          {history.length > 0 && (
            <Button size="sm" variant="ghost" icon={<Eraser size={13} />} onClick={() => setHistory([])}>
              清空
            </Button>
          )}
        </div>
      }
    >
      {/* 快捷命令 */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {QUICK_AT.map((c) => (
          <button
            key={c}
            onClick={() => send(c)}
            disabled={sending}
            className="rounded-full bg-slate-100 px-2.5 py-1 font-mono text-xs text-slate-600 transition-colors hover:bg-slate-200 disabled:opacity-50 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
          >
            {c}
          </button>
        ))}
      </div>

      {/* 输入行 */}
      <div className="mb-3 flex gap-2">
        <Input
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="输入 AT 命令，如 ATI"
          className="flex-1 font-mono"
        />
        <Select
          value={timeoutSec}
          onChange={(e) => setTimeoutSec(Number(e.target.value))}
          className="w-24 shrink-0"
          title="超时（秒）"
        >
          {[1, 3, 5, 10, 15, 30].map((s) => (
            <option key={s} value={s}>
              {s} 秒
            </option>
          ))}
        </Select>
        <Button icon={<Send size={13} />} loading={sending} disabled={!cmd.trim()} onClick={() => send()}>
          发送
        </Button>
      </div>

      {/* 历史记录（新消息在上） */}
      {history.length === 0 ? (
        <EmptyState text="尚未发送命令" icon={<Terminal size={20} />} />
      ) : (
        <div className="max-h-96 space-y-2 overflow-y-auto">
          {history.map((e) => (
            <div key={e.id} className="rounded-xl bg-slate-50 p-3 dark:bg-white/5">
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`font-mono text-sm font-semibold ${
                    e.isError ? 'text-red-500' : 'text-slate-800 dark:text-slate-100'
                  }`}
                >
                  &gt; {e.command}
                </span>
                <span className="tabular shrink-0 text-[10px] text-slate-400">{fmtTime(e.time)}</span>
              </div>
              <pre
                className={`mt-1 whitespace-pre-wrap break-all font-mono text-xs ${
                  e.isError ? 'text-red-400' : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {e.response}
              </pre>
              {(e.port || e.elapsedMs != null) && (
                <div className="tabular mt-1 text-[10px] text-slate-400">
                  {[e.port, e.elapsedMs != null ? `${e.elapsedMs}ms` : ''].filter(Boolean).join(' · ')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

/* ================= 2. 网速测试 ================= */

const SPEED_PHASE: Record<string, string> = {
  idle: '空闲',
  latency: '延迟测试',
  download: '下行测试',
  upload: '上行测试',
  complete: '已完成',
  cancelled: '已取消',
  error: '出错',
}

function SpeedTestPanel() {
  const servers = useAsync<any[]>(() => api.get('/api/speedtest/servers'))
  const prog = usePolledData<any>(() => api.get('/api/speedtest/progress'), 1000)
  const [serverId, setServerId] = useState('')
  const [acting, setActing] = useState(false)

  const p = prog.data
  const phase: string = p?.phase ?? 'idle'
  const running = phase === 'latency' || phase === 'download' || phase === 'upload'

  const start = async () => {
    setActing(true)
    try {
      await api.post('/api/speedtest/start', serverId ? { server_id: Number(serverId) } : {})
      toast.success('测速已开始')
      prog.refresh()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setActing(false)
    }
  }

  const stop = async () => {
    setActing(true)
    try {
      await api.post('/api/speedtest/stop')
      toast.success('已请求停止')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setActing(false)
    }
  }

  return (
    <Card
      title="网速测试"
      icon={<Gauge size={15} />}
      extra={<Badge tone={running ? 'brand' : 'slate'}>{SPEED_PHASE[phase] ?? phase}</Badge>}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select
          value={serverId}
          onChange={(e) => setServerId(e.target.value)}
          disabled={running}
          className="min-w-0 flex-1"
        >
          <option value="">自动选择服务器</option>
          {(servers.data ?? []).map((s: any) => (
            <option key={s.id} value={s.id}>
              {s.sponsor} - {s.name}（{s.country}）
            </option>
          ))}
        </Select>
        {running ? (
          <Button variant="danger" icon={<Square size={13} />} loading={acting} onClick={stop}>
            停止
          </Button>
        ) : (
          <Button icon={<Play size={13} />} loading={acting} onClick={start}>
            开始测速
          </Button>
        )}
      </div>

      {servers.error && <ErrorBox error={`服务器列表加载失败：${servers.error}`} onRetry={servers.refresh} />}

      {p && phase !== 'idle' && (
        <div className="space-y-3">
          <div>
            <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
              <span className="truncate">
                {p.server ? `服务器：${p.server}` : SPEED_PHASE[phase] ?? phase}
              </span>
              <span className="tabular shrink-0">{num0(p.progress)}%</span>
            </div>
            <Progress value={num0(p.progress)} tone={phase === 'error' ? 'red' : 'brand'} />
          </div>

          {running && (
            <div className="text-center">
              <div className="tabular text-3xl font-bold text-brand-500">
                {num0(p.live_speed_mbps).toFixed(1)}
              </div>
              <div className="text-xs text-slate-400">Mbps · {SPEED_PHASE[phase]}</div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            <ResultBox
              label="延迟"
              value={p.ping_ms != null ? num0(p.ping_ms).toFixed(0) : '--'}
              unit="ms"
              sub={p.jitter_ms != null ? `抖动 ${num0(p.jitter_ms).toFixed(1)}ms` : undefined}
            />
            <ResultBox
              label="下行"
              value={p.download_mbps != null ? num0(p.download_mbps).toFixed(1) : '--'}
              unit="Mbps"
              tone="brand"
              sub={p.download_bytes ? fmtBytes(num0(p.download_bytes)) : undefined}
            />
            <ResultBox
              label="上行"
              value={p.upload_mbps != null ? num0(p.upload_mbps).toFixed(1) : '--'}
              unit="Mbps"
              tone="green"
              sub={p.upload_bytes ? fmtBytes(num0(p.upload_bytes)) : undefined}
            />
          </div>

          {phase === 'error' && (
            <p className="flex items-center gap-1.5 text-xs text-red-500">
              <AlertTriangle size={13} /> {p.error || '测速失败'}
            </p>
          )}
        </div>
      )}
      {!p && !prog.error && <Spinner text="读取测速状态…" />}
      {prog.error && !p && <ErrorBox error={prog.error} onRetry={prog.refresh} />}
    </Card>
  )
}

/* ================= 3. LAN 测速 ================= */

type LanPhase = 'idle' | 'ping' | 'download' | 'upload' | 'complete' | 'error'

const LAN_PHASE: Record<LanPhase, string> = {
  idle: '空闲',
  ping: '延迟测试',
  download: '下行测试',
  upload: '上行测试',
  complete: '已完成',
  error: '出错',
}

const LAN_DL_SIZE = 20 * 1024 * 1024 // 20 MB
const LAN_UL_SIZE = 10 * 1024 * 1024 // 10 MB

function LanTestPanel() {
  const [phase, setPhase] = useState<LanPhase>('idle')
  const [pingMs, setPingMs] = useState<number | null>(null)
  const [downMbps, setDownMbps] = useState<number | null>(null)
  const [upMbps, setUpMbps] = useState<number | null>(null)
  const [live, setLive] = useState(0)
  const [pct, setPct] = useState(0)
  const [err, setErr] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const running = phase === 'ping' || phase === 'download' || phase === 'upload'

  useEffect(() => () => abortRef.current?.abort(), [])

  const run = async () => {
    if (running) return
    setErr(null)
    setPingMs(null)
    setDownMbps(null)
    setUpMbps(null)
    setLive(0)
    setPct(0)
    const ac = new AbortController()
    abortRef.current = ac
    try {
      // --- Ping：8 次取中位数 ---
      setPhase('ping')
      const rtts: number[] = []
      for (let i = 0; i < 8; i++) {
        const t0 = performance.now()
        const r = await fetch('/api/lan/ping', { headers: authHeaders(), signal: ac.signal })
        if (!r.ok) throw new Error(`ping 失败 (${r.status})`)
        await r.arrayBuffer()
        rtts.push(performance.now() - t0)
        setPct(((i + 1) / 8) * 20)
      }
      rtts.sort((a, b) => a - b)
      setPingMs(Math.round(rtts[rtts.length >> 1] * 10) / 10)

      // --- 下行：流式读取计时 ---
      setPhase('download')
      setLive(0)
      const resp = await fetch(`/api/lan/download?size=${LAN_DL_SIZE}`, {
        headers: authHeaders(),
        signal: ac.signal,
      })
      if (!resp.ok || !resp.body) throw new Error(`下载失败 (${resp.status})`)
      const reader = resp.body.getReader()
      let received = 0
      const dlStart = performance.now()
      let lastUi = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.byteLength
        const now = performance.now()
        if (now - lastUi > 150) {
          lastUi = now
          setLive((received * 8) / ((now - dlStart) / 1000) / 1e6)
          setPct(20 + Math.min(1, received / LAN_DL_SIZE) * 40)
        }
      }
      const dlSecs = (performance.now() - dlStart) / 1000
      setDownMbps(Math.round(((received * 8) / dlSecs / 1e6) * 100) / 100)

      // --- 上行：POST 随机数据 ---
      setPhase('upload')
      setLive(0)
      setPct(70)
      const buf = new Uint8Array(LAN_UL_SIZE)
      for (let off = 0; off < LAN_UL_SIZE; off += 65536) {
        crypto.getRandomValues(buf.subarray(off, Math.min(off + 65536, LAN_UL_SIZE)))
      }
      const ulStart = performance.now()
      const ures = await fetch('/api/lan/upload', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/octet-stream' },
        body: buf,
        signal: ac.signal,
      })
      const ulSecs = (performance.now() - ulStart) / 1000
      let serverMbps: number | null = null
      try {
        const j = await ures.json()
        serverMbps = num(j?.data?.mbps)
      } catch {
        /* 忽略非 JSON 响应 */
      }
      if (!ures.ok) throw new Error(`上传失败 (${ures.status})`)
      setUpMbps(serverMbps ?? Math.round(((LAN_UL_SIZE * 8) / ulSecs / 1e6) * 100) / 100)
      setPct(100)
      setPhase('complete')
      toast.success('LAN 测速完成')
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        setPhase('idle')
        setPct(0)
      } else {
        setErr(e?.message || '测试失败')
        setPhase('error')
        toast.error(e?.message || '测试失败')
      }
    } finally {
      setLive(0)
      abortRef.current = null
    }
  }

  return (
    <Card
      title="LAN 测速"
      icon={<ArrowDownUp size={15} />}
      extra={<Badge tone={running ? 'brand' : 'slate'}>{LAN_PHASE[phase]}</Badge>}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs text-slate-400">测试设备到本机的局域网吞吐量（下行 20MB · 上行 10MB）</p>
        {running ? (
          <Button variant="danger" icon={<Square size={13} />} onClick={() => abortRef.current?.abort()}>
            停止
          </Button>
        ) : (
          <Button icon={<Play size={13} />} onClick={run}>
            开始测试
          </Button>
        )}
      </div>

      {(running || phase === 'complete') && (
        <div className="mb-3">
          <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
            <span>{LAN_PHASE[phase]}</span>
            <span className="tabular">{pct.toFixed(0)}%</span>
          </div>
          <Progress value={pct} />
          {running && phase !== 'ping' && (
            <div className="tabular mt-2 text-center text-2xl font-bold text-brand-500">
              {live > 0 ? `${live.toFixed(1)} Mbps` : '…'}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <ResultBox label="延迟" value={pingMs != null ? pingMs.toFixed(1) : '--'} unit="ms" />
        <ResultBox label="下行" value={downMbps != null ? downMbps.toFixed(1) : '--'} unit="Mbps" tone="brand" />
        <ResultBox label="上行" value={upMbps != null ? upMbps.toFixed(1) : '--'} unit="Mbps" tone="green" />
      </div>

      {err && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-red-500">
          <AlertTriangle size={13} /> {err}
        </p>
      )}
    </Card>
  )
}

/* ================= 4. 定时任务 ================= */

interface JobAction {
  method: string
  path: string
  body?: any
}

type JobSchedule =
  | { type: 'once'; at: number }
  | { type: 'recurring'; time: string; days: number[] }

interface JobRestore {
  time: string
  body?: any
}

interface Job {
  id: number
  name: string
  enabled: boolean
  schedule: JobSchedule
  action: JobAction
  restore?: JobRestore | null
  last_run: number | null
  last_status: number | null
  last_error?: string | null
  last_restore: number | null
  created_at: number
}

/** 动作模板（对齐 iOS ActionTemplate） */
const TEMPLATES = [
  { key: 'custom', label: '自定义请求', method: 'POST', path: '', body: '', restoreBody: '' },
  {
    key: 'airplane',
    label: '飞行模式 开/关',
    method: 'POST',
    path: '/api/modem/airplane',
    body: '{"operate_mode":"LPM"}',
    restoreBody: '{"operate_mode":"ONLINE"}',
  },
  {
    key: 'data',
    label: '移动数据 关/开',
    method: 'PUT',
    path: '/api/modem/data',
    body: '{"cid":1,"enable":0,"connect_status":"disconnected"}',
    restoreBody: '{"cid":1,"enable":1}',
  },
  {
    key: 'guest',
    label: '访客 WiFi 关/开',
    method: 'PUT',
    path: '/api/wifi/guest',
    body: '{"guest_disabled_2g":"1","guest_disabled_5g":"1"}',
    restoreBody: '{"guest_disabled_2g":"0","guest_disabled_5g":"0"}',
  },
  { key: 'reboot', label: '重启设备', method: 'POST', path: '/api/device/reboot', body: '', restoreBody: '' },
  {
    key: 'powersave',
    label: '省电模式 开/关',
    method: 'PUT',
    path: '/api/device/power-save',
    body: '{"deviceInfoList":{"power_saver_mode":"1"}}',
    restoreBody: '{"deviceInfoList":{"power_saver_mode":"0"}}',
  },
]

const DAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] // 0=周一（后端约定）

function scheduleText(s: JobSchedule): string {
  if (s.type === 'once') return `${fmtTime(s.at, true)} 执行一次`
  const days = [...(s.days ?? [])].sort((a, b) => a - b)
  let d: string
  if (days.length === 7) d = '每天'
  else if (days.join(',') === '0,1,2,3,4') d = '工作日'
  else if (days.join(',') === '5,6') d = '周末'
  else d = days.map((i) => DAY_NAMES[i] ?? `${i}`).join(' ')
  return `${d} ${s.time}`
}

function templateLabel(j: Job): string | null {
  const t = TEMPLATES.find((t) => t.key !== 'custom' && t.method === j.action.method && t.path === j.action.path)
  return t ? t.label : null
}

/** unix 秒 → datetime-local 输入框值 */
function toLocalInput(tsSecs: number): string {
  const d = new Date(tsSecs * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

interface JobForm {
  name: string
  template: string
  method: string
  path: string
  bodyText: string
  scheduleType: 'recurring' | 'once'
  time: string
  days: number[]
  onceAt: string
  restoreEnabled: boolean
  restoreTime: string
  restoreBodyText: string
}

function blankForm(): JobForm {
  const t = TEMPLATES[1]
  return {
    name: '',
    template: t.key,
    method: t.method,
    path: t.path,
    bodyText: t.body,
    scheduleType: 'recurring',
    time: '23:00',
    days: [0, 1, 2, 3, 4],
    onceAt: toLocalInput(Math.floor(Date.now() / 1000) + 3600),
    restoreEnabled: false,
    restoreTime: '06:30',
    restoreBodyText: t.restoreBody,
  }
}

function formFromJob(j: Job): JobForm {
  const t = TEMPLATES.find((t) => t.key !== 'custom' && t.method === j.action.method && t.path === j.action.path)
  const base = blankForm()
  return {
    name: j.name,
    template: t?.key ?? 'custom',
    method: j.action.method,
    path: j.action.path,
    bodyText: j.action.body != null ? JSON.stringify(j.action.body) : '',
    scheduleType: j.schedule.type,
    time: j.schedule.type === 'recurring' ? j.schedule.time : base.time,
    days: j.schedule.type === 'recurring' ? [...j.schedule.days] : base.days,
    onceAt: j.schedule.type === 'once' ? toLocalInput(j.schedule.at) : base.onceAt,
    restoreEnabled: !!j.restore,
    restoreTime: j.restore?.time ?? base.restoreTime,
    restoreBodyText: j.restore?.body != null ? JSON.stringify(j.restore.body) : (t?.restoreBody ?? ''),
  }
}

function SchedulerPanel() {
  const jobs = useAsync<Job[]>(() => api.get('/api/scheduler/jobs'))
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Job | null>(null)
  const [form, setForm] = useState<JobForm>(blankForm())
  const [saving, setSaving] = useState(false)
  const [toggling, setToggling] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<Job | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  const set = <K extends keyof JobForm>(k: K, v: JobForm[K]) => setForm((f) => ({ ...f, [k]: v }))

  const applyTemplate = (key: string) => {
    const t = TEMPLATES.find((t) => t.key === key)
    if (!t) return
    setForm((f) => ({
      ...f,
      template: key,
      method: t.method,
      path: t.path,
      bodyText: t.body,
      restoreBodyText: t.restoreBody,
    }))
  }

  const openCreate = () => {
    setEditing(null)
    setForm(blankForm())
    setModalOpen(true)
  }

  const openEdit = (j: Job) => {
    setEditing(j)
    setForm(formFromJob(j))
    setModalOpen(true)
  }

  const toggleJob = async (j: Job, enabled: boolean) => {
    setToggling(j.id)
    try {
      await api.put('/api/scheduler/jobs/toggle', { id: j.id, enabled })
      jobs.setData((prev) => (prev ?? []).map((x) => (x.id === j.id ? { ...x, enabled } : x)))
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setToggling(null)
    }
  }

  const submit = async () => {
    if (!form.name.trim()) return toast.error('请输入任务名称')
    if (!form.path.trim().startsWith('/api/')) return toast.error('请求路径需以 /api/ 开头')

    let body: any
    if (form.bodyText.trim()) {
      try {
        body = JSON.parse(form.bodyText)
      } catch {
        return toast.error('动作 Body 不是合法 JSON')
      }
    }

    let schedule: JobSchedule
    if (form.scheduleType === 'once') {
      const ts = new Date(form.onceAt).getTime()
      if (!form.onceAt || isNaN(ts)) return toast.error('请选择执行时间')
      schedule = { type: 'once', at: Math.floor(ts / 1000) }
    } else {
      if (!/^\d{2}:\d{2}$/.test(form.time)) return toast.error('请输入执行时间')
      if (form.days.length === 0) return toast.error('请至少选择一天')
      schedule = { type: 'recurring', time: form.time, days: [...form.days].sort((a, b) => a - b) }
    }

    let restore: JobRestore | null = null
    if (form.restoreEnabled) {
      let rb: any
      if (form.restoreBodyText.trim()) {
        try {
          rb = JSON.parse(form.restoreBodyText)
        } catch {
          return toast.error('恢复 Body 不是合法 JSON')
        }
      }
      restore = { time: form.restoreTime, ...(rb !== undefined ? { body: rb } : {}) }
    }

    const payload: any = {
      name: form.name.trim(),
      schedule,
      action: { method: form.method, path: form.path.trim(), ...(body !== undefined ? { body } : {}) },
      restore,
    }

    setSaving(true)
    try {
      if (editing) {
        await api.put('/api/scheduler/jobs', { id: editing.id, enabled: editing.enabled, ...payload })
        toast.success('任务已更新')
      } else {
        await api.post('/api/scheduler/jobs', payload)
        toast.success('任务已创建')
      }
      setModalOpen(false)
      jobs.refresh()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    if (!deleting) return
    setDeleteLoading(true)
    try {
      await api.delete('/api/scheduler/jobs', { id: deleting.id })
      toast.success('任务已删除')
      setDeleting(null)
      jobs.refresh()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setDeleteLoading(false)
    }
  }

  const list = jobs.data ?? []

  return (
    <>
      <Card
        title="定时任务"
        icon={<CalendarClock size={15} />}
        extra={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} onClick={jobs.refresh} title="刷新">
              {''}
            </Button>
            <Button size="sm" icon={<Plus size={13} />} onClick={openCreate}>
              新建任务
            </Button>
          </div>
        }
      >
        {jobs.loading && list.length === 0 ? (
          <Spinner />
        ) : jobs.error && list.length === 0 ? (
          <ErrorBox error={jobs.error} onRetry={jobs.refresh} />
        ) : list.length === 0 ? (
          <EmptyState text="暂无定时任务，点击右上角新建" icon={<CalendarClock size={20} />} />
        ) : (
          <div className="space-y-2">
            {list.map((j) => {
              const tpl = templateLabel(j)
              return (
                <div
                  key={j.id}
                  className="flex items-start justify-between gap-3 rounded-xl border border-slate-100 p-3 dark:border-white/5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-slate-800 dark:text-slate-100">{j.name}</span>
                      <Badge tone={j.schedule.type === 'recurring' ? 'blue' : 'slate'}>
                        {j.schedule.type === 'recurring' ? '周期' : '单次'}
                      </Badge>
                      {tpl && <Badge tone="brand">{tpl}</Badge>}
                      {!j.enabled && <Badge>已停用</Badge>}
                    </div>
                    <div className="tabular mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {scheduleText(j.schedule)}
                      {j.restore && ` · ${j.restore.time} 恢复`}
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-slate-400">
                      {j.action.method} {j.action.path}
                    </div>
                    {j.last_run != null && (
                      <div className="tabular mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                        <span>上次执行 {fmtTime(j.last_run, true)}</span>
                        {j.last_status != null &&
                          (j.last_status >= 200 && j.last_status < 300 ? (
                            <Badge tone="green">{j.last_status}</Badge>
                          ) : (
                            <Badge tone="red">{j.last_status}</Badge>
                          ))}
                        {j.last_error && <span className="text-red-400">{j.last_error}</span>}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Toggle
                      checked={j.enabled}
                      loading={toggling === j.id}
                      onChange={(v) => toggleJob(j, v)}
                    />
                    <Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={() => openEdit(j)} title="编辑" >
                      {''}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Trash2 size={13} />}
                      onClick={() => setDeleting(j)}
                      title="删除"
                    >
                      {''}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* 新建 / 编辑 */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? '编辑任务' : '新建任务'}
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              取消
            </Button>
            <Button loading={saving} onClick={submit}>
              保存
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="任务名称">
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="如：夜间开启飞行模式" />
          </Field>

          <Field label="动作模板" hint="选择模板会自动填充请求，可再手动修改">
            <Select value={form.template} onChange={(e) => applyTemplate(e.target.value)}>
              {TEMPLATES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[6rem_1fr]">
            <Field label="方法">
              <Select value={form.method} onChange={(e) => set('method', e.target.value)}>
                {['GET', 'POST', 'PUT', 'DELETE'].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="请求路径">
              <Input value={form.path} onChange={(e) => set('path', e.target.value)} placeholder="/api/..." className="font-mono" />
            </Field>
          </div>

          <Field label="请求 Body（JSON，可留空）">
            <textarea
              value={form.bodyText}
              onChange={(e) => set('bodyText', e.target.value)}
              rows={2}
              placeholder='{"key":"value"}'
              className="w-full rounded-lg border border-slate-300/80 bg-white px-3 py-1.5 font-mono text-xs text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-white/10 dark:bg-white/5 dark:text-slate-100"
            />
          </Field>

          <Field label="执行方式">
            <div className="flex gap-1 rounded-xl bg-slate-200/60 p-1 dark:bg-white/5">
              {(
                [
                  { key: 'recurring', label: '周期执行' },
                  { key: 'once', label: '单次执行' },
                ] as const
              ).map((o) => (
                <button
                  key={o.key}
                  onClick={() => set('scheduleType', o.key)}
                  className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    form.scheduleType === o.key
                      ? 'bg-white text-slate-800 shadow-sm dark:bg-surface-800 dark:text-white'
                      : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </Field>

          {form.scheduleType === 'recurring' ? (
            <>
              <Field label="执行时间">
                <Input type="time" value={form.time} onChange={(e) => set('time', e.target.value)} className="tabular w-32" />
              </Field>
              <Field label="重复日期">
                <div className="grid grid-cols-7 gap-1">
                  {DAY_NAMES.map((d, i) => {
                    const on = form.days.includes(i)
                    return (
                      <button
                        key={d}
                        onClick={() =>
                          set('days', on ? form.days.filter((x) => x !== i) : [...form.days, i])
                        }
                        className={`rounded-lg px-1 py-1.5 text-xs font-medium transition-colors ${
                          on
                            ? 'bg-brand-600 text-white'
                            : 'bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-white/5 dark:text-slate-400 dark:hover:bg-white/10'
                        }`}
                      >
                        {d.slice(1)}
                      </button>
                    )
                  })}
                </div>
              </Field>
            </>
          ) : (
            <Field label="执行时间">
              <Input
                type="datetime-local"
                value={form.onceAt}
                onChange={(e) => set('onceAt', e.target.value)}
                className="tabular w-56"
              />
            </Field>
          )}

          <div className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-white/5">
            <Field inline label="定时恢复（到点执行恢复请求）">
              <Toggle checked={form.restoreEnabled} onChange={(v) => set('restoreEnabled', v)} />
            </Field>
            {form.restoreEnabled && (
              <div className="mt-2 space-y-2 border-t border-slate-200/70 pt-2 dark:border-white/5">
                <Field label="恢复时间">
                  <Input
                    type="time"
                    value={form.restoreTime}
                    onChange={(e) => set('restoreTime', e.target.value)}
                    className="tabular w-32"
                  />
                </Field>
                <Field label="恢复 Body（JSON，可留空）">
                  <textarea
                    value={form.restoreBodyText}
                    onChange={(e) => set('restoreBodyText', e.target.value)}
                    rows={2}
                    className="w-full rounded-lg border border-slate-300/80 bg-white px-3 py-1.5 font-mono text-xs text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-white/10 dark:bg-white/5 dark:text-slate-100"
                  />
                </Field>
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* 删除确认 */}
      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={doDelete}
        title="删除定时任务"
        message={`确定删除任务「${deleting?.name}」吗？此操作不可撤销。`}
        danger
        loading={deleteLoading}
        confirmText="删除"
      />
    </>
  )
}

/* ================= 5. 进程管理 ================= */

const PROC_STATE: Record<string, string> = {
  R: '运行',
  S: '睡眠',
  D: '等待',
  Z: '僵尸',
  T: '停止',
  I: '空闲',
}

function ProcessPanel() {
  const top = usePolledData<any>(() => api.get('/api/system/top'), 5000)
  const [selected, setSelected] = useState<number | null>(null)
  const [killing, setKilling] = useState(false)

  const d = top.data
  const processes: any[] = d?.processes ?? []
  const selProc = processes.find((p) => p.pid === selected) ?? null

  const kill = async (body: { all: true } | { pids: number[] }) => {
    setKilling(true)
    try {
      const r = await api.post('/api/system/kill-bloat', body)
      toast.success(`已清理 ${r.killed?.length ?? 0} 个进程，释放 ${fmtBytes(num0(r.freed_rss_kb) * 1024)}`)
      setSelected(null)
      top.refresh()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setKilling(false)
    }
  }

  return (
    <Card
      title="进程管理"
      icon={<ListOrdered size={15} />}
      extra={
        <div className="flex items-center gap-2">
          {d && <Badge tone="slate">{d.total_count} 个进程</Badge>}
          {selProc && (
            <Button
              size="sm"
              variant="danger"
              icon={<Trash2 size={13} />}
              loading={killing}
              disabled={!selProc.is_bloat}
              title={selProc.is_bloat ? `清理 PID ${selProc.pid}` : '仅可清理标记为冗余的进程'}
              onClick={() => kill({ pids: [selProc.pid] })}
            >
              清理选中
            </Button>
          )}
          <Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} onClick={top.refresh} title="刷新">
            {''}
          </Button>
        </div>
      }
      pad={false}
    >
      <div className="p-4 pb-0">
        {d && num0(d.bloat_count) > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-500/20 dark:bg-amber-500/10">
            <span className="tabular text-xs text-amber-600 dark:text-amber-400">
              发现 {d.bloat_count} 个冗余守护进程，占用 {fmtBytes(num0(d.bloat_rss_kb) * 1024)} 内存 · CPU{' '}
              {num0(d.bloat_cpu_pct).toFixed(1)}%
            </span>
            <Button size="sm" variant="danger" icon={<Trash2 size={13} />} loading={killing} onClick={() => kill({ all: true })}>
              清理全部冗余
            </Button>
          </div>
        )}
      </div>

      {!d ? (
        top.error ? (
          <ErrorBox error={top.error} onRetry={top.refresh} />
        ) : (
          <Spinner />
        )
      ) : processes.length === 0 ? (
        <EmptyState text="暂无进程数据" />
      ) : (
        <div className="mt-3 max-h-[30rem] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white dark:bg-surface-900">
              <tr className="text-left text-xs text-slate-400">
                <th className="px-4 py-2 font-medium">PID</th>
                <th className="py-2 pr-2 font-medium">名称</th>
                <th className="py-2 pr-2 text-right font-medium">CPU</th>
                <th className="py-2 pr-2 text-right font-medium">内存</th>
                <th className="hidden py-2 pr-2 font-medium sm:table-cell">状态</th>
                <th className="py-2 pr-4 text-right font-medium">标记</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {processes.map((p) => (
                <tr
                  key={p.pid}
                  onClick={() => setSelected(selected === p.pid ? null : p.pid)}
                  className={`cursor-pointer transition-colors ${
                    selected === p.pid
                      ? 'bg-brand-50 dark:bg-brand-500/10'
                      : 'hover:bg-slate-50 dark:hover:bg-white/5'
                  }`}
                >
                  <td className="tabular px-4 py-2 font-mono text-xs text-slate-400">{p.pid}</td>
                  <td className="max-w-0 truncate py-2 pr-2 font-medium text-slate-700 dark:text-slate-200">
                    {p.name}
                  </td>
                  <td className="tabular py-2 pr-2 text-right text-xs">{num0(p.cpu_pct).toFixed(1)}%</td>
                  <td className="tabular py-2 pr-2 text-right text-xs text-slate-500 dark:text-slate-400">
                    {fmtBytes(num0(p.rss_kb) * 1024)}
                  </td>
                  <td className="hidden py-2 pr-2 text-xs text-slate-400 sm:table-cell">
                    {PROC_STATE[p.state] ?? p.state ?? '--'}
                  </td>
                  <td className="py-2 pr-4 text-right">
                    {p.is_bloat ? (
                      <Badge tone="yellow">冗余</Badge>
                    ) : (
                      <span className="text-xs text-slate-300 dark:text-slate-600">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

/* ================= 页面 ================= */

export default function ToolsPage() {
  const [tab, setTab] = useState('at')
  return (
    <div className="space-y-4">
      <PageHeader title="工具箱" desc="AT 终端 / 测速 / 定时任务 / 进程管理" />
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'at', label: 'AT 终端', icon: <Terminal size={14} /> },
          { key: 'speedtest', label: '网速测试', icon: <Gauge size={14} /> },
          { key: 'lan', label: 'LAN 测速', icon: <ArrowDownUp size={14} /> },
          { key: 'scheduler', label: '定时任务', icon: <CalendarClock size={14} /> },
          { key: 'process', label: '进程管理', icon: <ListOrdered size={14} /> },
        ]}
      />
      {tab === 'at' && <AtTerminal />}
      {tab === 'speedtest' && <SpeedTestPanel />}
      {tab === 'lan' && <LanTestPanel />}
      {tab === 'scheduler' && <SchedulerPanel />}
      {tab === 'process' && <ProcessPanel />}
    </div>
  )
}
