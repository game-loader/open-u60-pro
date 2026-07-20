import { useEffect, useState } from 'react'
import {
  Phone,
  PhoneOff,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneCall,
  Delete,
  Mic,
  MicOff,
  Hash,
  Asterisk,
  Terminal,
  CreditCard,
  RefreshCw,
  Send,
  Ban,
} from 'lucide-react'
import { api } from '../lib/api'
import { usePoll } from '../lib/hooks'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Spinner,
  Toggle,
  toast,
} from '../components/ui'

/* ================= 类型（对齐 zte-agent telephony.rs） ================= */

interface CallEntry {
  id: number
  dir: string // mo / mt
  stat: string // active / held / dialing / alerting / incoming / waiting / releasing
  mode: number
  number: string
}

type Phase = 'idle' | 'dialing' | 'alerting' | 'incoming' | 'active' | 'held'

interface UssdExchange {
  q: string
  a: string
  session: boolean
}

interface StkItem {
  id: number
  label: string
}

interface StkMenuState {
  supported: boolean
  title: string
  items: StkItem[]
  reason?: string
}

const PHASE_META: Record<Phase, { label: string; badge: 'slate' | 'brand' | 'green' | 'yellow'; circle: string }> = {
  idle: { label: '空闲', badge: 'slate', circle: 'bg-slate-100 text-slate-400 dark:bg-white/5' },
  dialing: { label: '拨出中…', badge: 'brand', circle: 'bg-brand-500/15 text-brand-500' },
  alerting: { label: '对方振铃中…', badge: 'brand', circle: 'bg-brand-500/15 text-brand-500' },
  incoming: { label: '来电响铃', badge: 'yellow', circle: 'bg-amber-500/15 text-amber-500' },
  active: { label: '通话中', badge: 'green', circle: 'bg-emerald-500/15 text-emerald-500' },
  held: { label: '通话保持', badge: 'yellow', circle: 'bg-amber-500/15 text-amber-500' },
}

const DIAL_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#']

function fmtDur(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const p = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`
}

/* ================= 页面 ================= */

export default function Call() {
  /* ---- 通话状态（2s 轮询 AT+CLCC） ---- */
  const [calls, setCalls] = useState<CallEntry[]>([])
  usePoll(async () => {
    try {
      const d = await api.get('/api/call/status')
      setCalls(Array.isArray(d?.calls) ? d.calls : [])
    } catch {
      /* AT 端口可能忙，静默 */
    }
  }, 2000)

  const current: CallEntry | null = calls[0] ?? null
  const phase: Phase = !current
    ? 'idle'
    : current.stat === 'dialing'
      ? 'dialing'
      : current.stat === 'alerting'
        ? 'alerting'
        : current.stat === 'incoming' || current.stat === 'waiting'
          ? 'incoming'
          : current.stat === 'active'
            ? 'active'
            : current.stat === 'held'
              ? 'held'
              : 'idle'

  const inCall = phase === 'active' || phase === 'held'
  const meta = PHASE_META[phase]

  /* ---- 通话时长 ---- */
  const [activeSince, setActiveSince] = useState<number | null>(null)
  const [durSec, setDurSec] = useState(0)
  const [muted, setMuted] = useState(false)

  useEffect(() => {
    if (phase === 'active') {
      setActiveSince((prev) => prev ?? Date.now())
    } else {
      setActiveSince(null)
      setDurSec(0)
      setMuted(false)
    }
  }, [phase])

  useEffect(() => {
    if (activeSince == null) return
    const t = setInterval(() => setDurSec(Math.floor((Date.now() - activeSince) / 1000)), 1000)
    return () => clearInterval(t)
  }, [activeSince])

  /* ---- 操作 ---- */
  const [acting, setActing] = useState<string | null>(null)
  const run = async (key: string, fn: () => Promise<any>, okMsg?: string) => {
    setActing(key)
    try {
      await fn()
      if (okMsg) toast.success(okMsg)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setActing(null)
    }
  }

  const [number, setNumber] = useState('')

  const dial = () => {
    const n = number.trim()
    if (!n) return
    run('dial', () => api.post('/api/call/dial', { number: n }), '拨号中…')
  }
  const hangup = () => run('hangup', () => api.post('/api/call/hangup'))
  const answer = () => run('answer', () => api.post('/api/call/answer'))
  const toggleMute = (v: boolean) =>
    run('mute', async () => {
      const r = await api.post('/api/call/mute', { enabled: v })
      setMuted(r?.muted ?? v)
    })

  const pressKey = (k: string) => {
    if (inCall) {
      // 通话中按键 → DTMF
      api.post('/api/call/dtmf', { digits: k }).catch((e: any) => toast.error(e.message))
    } else {
      setNumber((n) => (n.length < 24 ? n + k : n))
    }
  }
  const backspace = () => setNumber((n) => n.slice(0, -1))

  /* ---- USSD ---- */
  const [ussdCode, setUssdCode] = useState('')
  const [ussdReply, setUssdReply] = useState('')
  const [ussdLog, setUssdLog] = useState<UssdExchange[]>([])
  const [ussdSession, setUssdSession] = useState(false)
  const [ussdBusy, setUssdBusy] = useState(false)

  const ussdSend = async (text: string, isReply: boolean) => {
    const t = text.trim()
    if (!t) return
    setUssdBusy(true)
    try {
      const r = await api.post(
        isReply ? '/api/ussd/respond' : '/api/ussd/send',
        isReply ? { reply: t } : { code: t },
      )
      setUssdLog((prev) => [...prev, { q: t, a: String(r?.response ?? '（无响应）'), session: !!r?.session_active }])
      setUssdSession(!!r?.session_active)
      if (isReply) setUssdReply('')
      else setUssdCode('')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setUssdBusy(false)
    }
  }

  const ussdCancel = async () => {
    setUssdBusy(true)
    try {
      await api.post('/api/ussd/cancel')
      setUssdSession(false)
      toast.success('USSD 会话已取消')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setUssdBusy(false)
    }
  }

  /* ---- STK ---- */
  const [stk, setStk] = useState<StkMenuState | null>(null)
  const [stkLoading, setStkLoading] = useState(false)
  const [stkDisplay, setStkDisplay] = useState<string | null>(null)
  const [stkBusy, setStkBusy] = useState<number | null>(null)

  const loadStk = async () => {
    setStkLoading(true)
    setStkDisplay(null)
    try {
      const d = await api.get('/api/stk/menu')
      setStk({
        supported: !!d?.supported,
        title: d?.title || 'SIM 应用',
        items: Array.isArray(d?.items) ? d.items : [],
        reason: d?.reason,
      })
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setStkLoading(false)
    }
  }

  useEffect(() => {
    loadStk()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stkSelect = async (item: StkItem) => {
    setStkBusy(item.id)
    try {
      const d = await api.post('/api/stk/select', { item_id: item.id })
      if (d?.type === 'menu') {
        setStk({ supported: true, title: d?.title || 'SIM 应用', items: Array.isArray(d?.items) ? d.items : [] })
        setStkDisplay(null)
      } else {
        setStkDisplay(String(d?.data ?? '（无内容）'))
      }
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setStkBusy(null)
    }
  }

  /* ---- 渲染 ---- */

  const phaseIcon =
    phase === 'incoming' ? (
      <PhoneIncoming size={26} className="animate-pulse" />
    ) : phase === 'dialing' || phase === 'alerting' ? (
      <PhoneOutgoing size={26} className="animate-pulse" />
    ) : phase === 'active' || phase === 'held' ? (
      <PhoneCall size={26} />
    ) : (
      <Phone size={26} />
    )

  return (
    <div className="space-y-4">
      <PageHeader title="通话" desc="拨打电话 · USSD 查询 · SIM 应用（STK）" />

      <div className="grid gap-3 lg:grid-cols-2">
        {/* 通话状态 */}
        <Card title="通话状态" icon={<Phone size={15} />} extra={<Badge tone={meta.badge}>{meta.label}</Badge>}>
          <div className="flex flex-col items-center gap-1.5 py-2 text-center">
            <div className={`flex h-16 w-16 items-center justify-center rounded-full ${meta.circle}`}>
              {phaseIcon}
            </div>
            <div className="mt-1 text-base font-semibold text-slate-800 dark:text-slate-100">{meta.label}</div>
            <div className="tabular text-sm text-slate-400">
              {phase === 'idle' ? '无进行中的通话' : current?.number || '未知号码'}
              {current && <span className="ml-1 text-xs">({current.dir === 'mt' ? '呼入' : '呼出'})</span>}
            </div>
            {phase === 'active' && (
              <div className="tabular text-2xl font-bold text-emerald-500">{fmtDur(durSec)}</div>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
            {phase === 'incoming' && (
              <>
                <Button
                  variant="success"
                  icon={<PhoneIncoming size={14} />}
                  loading={acting === 'answer'}
                  onClick={answer}
                >
                  接听
                </Button>
                <Button variant="danger" icon={<PhoneOff size={14} />} loading={acting === 'hangup'} onClick={hangup}>
                  挂断
                </Button>
              </>
            )}
            {(phase === 'active' || phase === 'held' || phase === 'dialing' || phase === 'alerting') && (
              <Button variant="danger" icon={<PhoneOff size={14} />} loading={acting === 'hangup'} onClick={hangup}>
                挂断
              </Button>
            )}
            {phase === 'active' && (
              <span className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                {muted ? <MicOff size={14} className="text-red-400" /> : <Mic size={14} />}
                静音
                <Toggle checked={muted} loading={acting === 'mute'} onChange={toggleMute} />
              </span>
            )}
          </div>
        </Card>

        {/* 拨号盘 */}
        <Card
          title={inCall ? 'DTMF 键盘' : '拨号盘'}
          icon={<Hash size={15} />}
          extra={inCall ? <Badge tone="green">按键发送 DTMF</Badge> : undefined}
        >
          <div className="tabular flex h-12 items-center justify-center rounded-xl bg-slate-100 px-3 text-2xl font-semibold tracking-widest text-slate-800 dark:bg-white/5 dark:text-slate-100">
            {inCall ? (
              <span className="text-base font-normal tracking-normal text-slate-400">
                {current?.number || '通话中'}
              </span>
            ) : number ? (
              number
            ) : (
              <span className="text-base font-normal tracking-normal text-slate-400">请输入号码</span>
            )}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {DIAL_KEYS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => pressKey(k)}
                className="flex items-center justify-center rounded-xl bg-slate-100 py-3 text-xl font-semibold text-slate-800 transition-colors hover:bg-slate-200 active:bg-slate-300 dark:bg-white/5 dark:text-slate-100 dark:hover:bg-white/10 dark:active:bg-white/15"
              >
                {k === '*' ? <Asterisk size={20} /> : k === '#' ? <Hash size={20} /> : k}
              </button>
            ))}
          </div>
          {!inCall && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button variant="secondary" icon={<Delete size={15} />} disabled={!number} onClick={backspace}>
                删除
              </Button>
              <Button
                variant="success"
                icon={<Phone size={15} />}
                loading={acting === 'dial'}
                disabled={!number.trim()}
                onClick={dial}
              >
                拨打
              </Button>
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* USSD */}
        <Card
          title="USSD 查询"
          icon={<Terminal size={15} />}
          extra={ussdSession ? <Badge tone="green">会话中</Badge> : undefined}
        >
          <div className="flex gap-2">
            <Input
              value={ussdCode}
              onChange={(e) => setUssdCode(e.target.value)}
              placeholder="输入代码，如 *123#"
              onKeyDown={(e) => e.key === 'Enter' && ussdSend(ussdCode, false)}
            />
            <Button
              icon={<Send size={13} />}
              loading={ussdBusy}
              disabled={!ussdCode.trim()}
              onClick={() => ussdSend(ussdCode, false)}
            >
              发送
            </Button>
          </div>

          {ussdLog.length > 0 && (
            <div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
              {ussdLog.map((x, i) => (
                <div key={i} className="rounded-xl bg-slate-50 p-2.5 text-sm dark:bg-white/5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="tabular font-mono text-xs font-semibold text-brand-500">{x.q}</span>
                    {x.session ? <Badge tone="green">可回复</Badge> : <Badge tone="slate">已结束</Badge>}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-all text-slate-700 dark:text-slate-200">{x.a}</p>
                </div>
              ))}
            </div>
          )}

          {ussdSession && (
            <div className="mt-3 flex gap-2">
              <Input
                value={ussdReply}
                onChange={(e) => setUssdReply(e.target.value)}
                placeholder="回复选项，如 1"
                onKeyDown={(e) => e.key === 'Enter' && ussdSend(ussdReply, true)}
              />
              <Button
                variant="secondary"
                loading={ussdBusy}
                disabled={!ussdReply.trim()}
                onClick={() => ussdSend(ussdReply, true)}
              >
                回复
              </Button>
              <Button variant="danger" icon={<Ban size={13} />} loading={ussdBusy} onClick={ussdCancel}>
                取消会话
              </Button>
            </div>
          )}

          {ussdLog.length === 0 && <EmptyState text="发送 USSD 代码查询话费、流量等" icon={<Terminal size={22} />} />}
        </Card>

        {/* STK */}
        <Card
          title={stk?.title || 'SIM 应用（STK）'}
          icon={<CreditCard size={15} />}
          extra={
            <Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} loading={stkLoading} onClick={loadStk}>
              刷新
            </Button>
          }
        >
          {stkLoading && !stk ? (
            <Spinner text="读取 SIM 菜单…" />
          ) : !stk ? (
            <EmptyState text="未能读取 STK 菜单" />
          ) : !stk.supported ? (
            <EmptyState text={stk.reason ? `SIM 不支持 STK（${stk.reason}）` : 'SIM 不支持 STK'} icon={<CreditCard size={22} />} />
          ) : stk.items.length === 0 ? (
            <EmptyState text={stk.reason ? `暂无可用的菜单（${stk.reason}）` : '暂无可用的 SIM 应用菜单'} icon={<CreditCard size={22} />} />
          ) : (
            <div className="space-y-2">
              {stk.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={stkBusy != null}
                  onClick={() => stkSelect(item)}
                  className="flex w-full items-center justify-between gap-2 rounded-xl bg-slate-100 px-3.5 py-2.5 text-left text-sm font-medium text-slate-800 transition-colors hover:bg-slate-200 disabled:opacity-50 dark:bg-white/5 dark:text-slate-100 dark:hover:bg-white/10"
                >
                  <span className="truncate">{item.label}</span>
                  {stkBusy === item.id && <RefreshCw size={14} className="shrink-0 animate-spin text-slate-400" />}
                </button>
              ))}
            </div>
          )}
          {stkDisplay && (
            <div className="mt-3 whitespace-pre-wrap break-all rounded-xl bg-slate-50 p-3 text-sm text-slate-700 dark:bg-white/5 dark:text-slate-200">
              {stkDisplay}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
