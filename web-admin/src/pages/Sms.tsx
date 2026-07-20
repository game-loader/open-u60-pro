import { useEffect, useMemo, useState } from 'react'
import {
  MessageSquare,
  Inbox,
  Send,
  Trash2,
  Check,
  CheckCheck,
  Plus,
  Pencil,
  RefreshCw,
  History,
  Settings2,
  Play,
  XCircle,
  CheckCircle2,
  Forward,
  ListFilter,
} from 'lucide-react'
import { api } from '../lib/api'
import { useAsync, usePolledData } from '../lib/hooks'
import { fmtMsgTime, num0 } from '../lib/format'
import {
  Badge,
  Button,
  Card,
  ConfirmModal,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  Modal,
  PageHeader,
  Progress,
  Select,
  Spinner,
  Tabs,
  Toggle,
  inputCls,
  toast,
} from '../components/ui'

/* ================= 类型与编解码工具（对齐 zte-agent sms.rs / sms_forward.rs） ================= */

interface SmsMessage {
  id: number
  number: string
  content: string
  ts: number // unix 秒
  tag: number // 0 已读 1 未读 2 已发 3 失败 4 草稿
  memStore: string
}

interface Conversation {
  key: string
  number: string
  messages: SmsMessage[]
  unread: number
  latestPreview: string
  latestTs: number
}

interface HttpHeader {
  name: string
  value: string
}

type SmsFilter =
  | { type: 'all' }
  | { type: 'sender'; patterns: string[] }
  | { type: 'content'; keywords: string[] }
  | { type: 'sender_and_content'; patterns: string[]; keywords: string[] }

type ForwardDestination =
  | { type: 'telegram'; bot_token: string; chat_id: string; silent?: boolean }
  | { type: 'webhook'; url: string; method?: string; headers?: HttpHeader[] }
  | { type: 'sms'; forward_number: string }
  | { type: 'ntfy'; url: string; topic: string; token?: string }
  | { type: 'discord'; webhook_url: string }
  | { type: 'slack'; webhook_url: string }

interface ForwardRule {
  id: number
  name: string
  enabled: boolean
  filter: SmsFilter
  destination: ForwardDestination
}

interface ForwardConfig {
  enabled: boolean
  poll_interval_secs: number
  mark_read_after_forward: boolean
  delete_after_forward: boolean
  rules: ForwardRule[]
}

interface ForwardLogEntry {
  timestamp: number
  sms_id: number
  sender: string
  content_preview: string
  rule_name: string
  destination_type: string
  success: boolean
  error?: string
  rule_id?: number
  content?: string
  date?: string
}

/** 判断是否为 UCS-2 hex（4 hex 字符 = 1 字） */
function isUcs2Hex(s: string): boolean {
  const t = s.trim()
  return t.length > 0 && t.length % 4 === 0 && /^[0-9a-fA-F]+$/.test(t)
}

function decodeUcs2Hex(hex: string): string {
  let out = ''
  for (let i = 0; i + 4 <= hex.length; i += 4) {
    const cp = parseInt(hex.slice(i, i + 4), 16)
    if (!isNaN(cp)) out += String.fromCodePoint(cp)
  }
  return out
}

function decodeContent(raw: string): string {
  if (isUcs2Hex(raw)) {
    const d = decodeUcs2Hex(raw.trim())
    if (d) return d
  }
  return raw
}

function encodeUcs2Hex(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    out += text.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0')
  }
  return out
}

/** ZTE 时间 "YY,MM,DD,HH,MM,SS,TZ"（TZ 为 15 分钟单位）→ unix 秒 */
function parseSmsDate(raw: string): number {
  const parts = raw.split(/[,;]/).map((s) => s.trim())
  if (parts.length < 6) return 0
  const nums = parts.slice(0, 6).map((s) => parseInt(s, 10))
  if (nums.some((n) => isNaN(n))) return 0
  const [yy, mm, dd, hh, mi, ss] = nums
  let tzSec = 0
  if (parts[6]) {
    const q = parseInt(parts[6], 10)
    if (!isNaN(q)) tzSec = q * 15 * 60
  }
  return Math.floor(Date.UTC(2000 + yy, mm - 1, dd, hh, mi, ss) / 1000) - tzSec
}

/** 发送时间格式 "YY;MM;DD;HH;MM;SS;+TZ"（TZ 为小时） */
function formatSmsTime(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const tzHours = -d.getTimezoneOffset() / 60
  const tz = tzHours >= 0 ? `+${tzHours}` : `${tzHours}`
  return `${p(d.getFullYear() % 100)};${p(d.getMonth() + 1)};${p(d.getDate())};${p(d.getHours())};${p(d.getMinutes())};${p(d.getSeconds())};${tz}`
}

const GSM7_CHARS =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜabcdefghijklmnopqrstuvwxyzäöñüà§'

function getEncodeType(text: string): 'GSM7_default' | 'UNICODE' {
  for (const ch of text) {
    if (!GSM7_CHARS.includes(ch)) return 'UNICODE'
  }
  return 'GSM7_default'
}

/** 会话分组键：号码末 8 位数字 */
function normalizeNumber(num: string): string {
  const digits = num.replace(/\D/g, '')
  return digits.length > 8 ? digits.slice(-8) : digits
}

function parseMessages(list: any): SmsMessage[] {
  const arr = list?.messages
  if (!Array.isArray(arr)) return []
  const out: SmsMessage[] = []
  for (const it of arr) {
    const id = Number(it?.id)
    if (!Number.isFinite(id)) continue
    out.push({
      id,
      number: String(it?.number ?? ''),
      content: decodeContent(String(it?.content ?? '')),
      ts: parseSmsDate(String(it?.date ?? '')),
      tag: Number(it?.tag ?? 0),
      memStore: String(it?.mem_store ?? ''),
    })
  }
  return out
}

function groupConversations(messages: SmsMessage[]): Conversation[] {
  const map = new Map<string, SmsMessage[]>()
  for (const m of messages) {
    const key = normalizeNumber(m.number) || m.number || '未知'
    const arr = map.get(key)
    if (arr) arr.push(m)
    else map.set(key, [m])
  }
  const convs: Conversation[] = []
  for (const [key, msgs] of map) {
    msgs.sort((a, b) => a.ts - b.ts || a.id - b.id)
    const latest = msgs[msgs.length - 1]
    const display = msgs.reduce((a, b) => (b.number.length >= a.number.length ? b : a)).number
    convs.push({
      key,
      number: display,
      messages: msgs,
      unread: msgs.filter((m) => m.tag === 1).length,
      latestPreview: latest.content,
      latestTs: latest.ts,
    })
  }
  convs.sort((a, b) => b.latestTs - a.latestTs)
  return convs
}

/** 发出方向：已发/失败/草稿靠右 */
const isOutgoing = (tag: number) => tag === 2 || tag === 3 || tag === 4

const TAG_META: Record<number, { label: string; cls: string }> = {
  3: { label: '发送失败', cls: 'text-red-300' },
  4: { label: '草稿', cls: 'text-amber-300' },
}

/* ================= Tab 1：消息 ================= */

function MessagesTab() {
  const { data, loading, error, refresh } = usePolledData<{ list: any; cap: any }>(async () => {
    const list = await api.post('/api/sms/list', {
      page: 0,
      data_per_page: 500,
      mem_store: 2,
      tags: 10,
      order_by: 'order by id desc',
    })
    const cap = await api.get('/api/sms/capacity').catch(() => null)
    return { list, cap }
  }, 10000)

  const messages = useMemo(() => parseMessages(data?.list), [data])
  const conversations = useMemo(() => groupConversations(messages), [messages])

  const [selKey, setSelKey] = useState<string | null>(null)
  const selected = conversations.find((c) => c.key === selKey) ?? conversations[0] ?? null

  // 写短信
  const [composeOpen, setComposeOpen] = useState(false)
  const [composeTo, setComposeTo] = useState('')
  const [composeText, setComposeText] = useState('')
  const [sending, setSending] = useState(false)

  // 删除
  const [delTarget, setDelTarget] = useState<SmsMessage | null>(null)
  const [deleting, setDeleting] = useState(false)

  const openCompose = (to = '') => {
    setComposeTo(to)
    setComposeText('')
    setComposeOpen(true)
  }

  const sendSms = async () => {
    const to = composeTo.trim()
    const text = composeText.trim()
    if (!to) return toast.error('请填写接收号码')
    if (!text) return toast.error('请填写短信内容')
    setSending(true)
    try {
      await api.post('/api/sms/send', {
        number: to,
        sms_time: formatSmsTime(),
        message_body: encodeUcs2Hex(text),
        id: '-1',
        encode_type: getEncodeType(text),
      })
      toast.success('短信已提交发送')
      setComposeOpen(false)
      refresh()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSending(false)
    }
  }

  const markRead = async (ids: number[]) => {
    if (ids.length === 0) return
    try {
      await api.post('/api/sms/read', { id: ids.map(String).join(';') + ';', tag: 0 })
      toast.success('已标记为已读')
      refresh()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const deleteOne = async () => {
    if (!delTarget) return
    setDeleting(true)
    try {
      await api.post('/api/sms/delete', { id: `${delTarget.id};` })
      toast.success('已删除')
      setDelTarget(null)
      refresh()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setDeleting(false)
    }
  }

  // 容量
  const cap = data?.cap
  const nvUsed = num0(cap?.sms_nvused_total)
  const nvTotal = num0(cap?.sms_nv_total)
  const simUsed = num0(cap?.sms_simused_total)
  const simTotal = num0(cap?.sms_sim_total)
  const used = nvUsed + simUsed
  const total = nvTotal + simTotal
  const unread = num0(cap?.sms_dev_unread_num)

  if (loading && !data) return <Spinner text="加载短信…" />
  if (error && !data) return <ErrorBox error={error} onRetry={refresh} />

  const encodeType = getEncodeType(composeText)

  return (
    <div className="space-y-3">
      {/* 容量 */}
      <Card
        title="短信存储"
        icon={<Inbox size={15} />}
        extra={
          <Button size="sm" icon={<Plus size={13} />} onClick={() => openCompose(selected?.number ?? '')}>
            写短信
          </Button>
        }
      >
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
          <span className="tabular">
            已用 <span className="font-semibold text-slate-700 dark:text-slate-200">{used}</span> / {total}
          </span>
          <span className="tabular">
            机身 {nvUsed}/{nvTotal} · SIM {simUsed}/{simTotal}
          </span>
          {unread > 0 && <Badge tone="brand">未读 {unread}</Badge>}
        </div>
        <Progress value={total > 0 ? (used / total) * 100 : 0} tone="auto" />
      </Card>

      {/* 会话 + 消息流 */}
      <div className="grid gap-3 lg:grid-cols-5">
        <Card
          title="会话"
          icon={<MessageSquare size={15} />}
          extra={<Badge tone="slate">{conversations.length}</Badge>}
          pad={false}
          className="lg:col-span-2"
        >
          {conversations.length === 0 ? (
            <EmptyState text="暂无短信" icon={<MessageSquare size={22} />} />
          ) : (
            <div className="max-h-[420px] divide-y divide-slate-100 overflow-y-auto dark:divide-white/5">
              {conversations.map((c) => (
                <button
                  key={c.key}
                  onClick={() => setSelKey(c.key)}
                  className={`w-full px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-white/5 ${
                    selected?.key === c.key ? 'bg-slate-100/80 dark:bg-white/10' : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                      {c.number}
                    </span>
                    <span className="shrink-0 text-[10px] text-slate-400">{fmtMsgTime(c.latestTs)}</span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-slate-400">{c.latestPreview}</span>
                    {c.unread > 0 && <Badge tone="brand">{c.unread}</Badge>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </Card>

        <Card
          title={selected ? selected.number : '消息'}
          icon={<MessageSquare size={15} />}
          extra={
            selected && selected.unread > 0 ? (
              <Button
                size="sm"
                variant="ghost"
                icon={<CheckCheck size={13} />}
                onClick={() => markRead(selected.messages.filter((m) => m.tag === 1).map((m) => m.id))}
              >
                全部已读
              </Button>
            ) : undefined
          }
          className="lg:col-span-3"
        >
          {!selected ? (
            <EmptyState text="选择左侧会话查看消息" />
          ) : (
            <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {selected.messages.map((m) => {
                const out = isOutgoing(m.tag)
                const meta = TAG_META[m.tag]
                return (
                  <div key={m.id} className={`flex ${out ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                        out
                          ? 'rounded-br-sm bg-brand-600 text-white'
                          : 'rounded-bl-sm bg-slate-100 text-slate-800 dark:bg-white/10 dark:text-slate-100'
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-all">{m.content}</p>
                      <div
                        className={`mt-1 flex items-center justify-end gap-1.5 text-[10px] ${
                          out ? 'text-white/70' : 'text-slate-400'
                        }`}
                      >
                        {meta && <span className={out ? meta.cls : 'text-red-500'}>{meta.label}</span>}
                        {m.memStore === 'sim' && <span>SIM</span>}
                        <span className="tabular">{fmtMsgTime(m.ts)}</span>
                        {m.tag === 1 && (
                          <button
                            title="标记已读"
                            onClick={() => markRead([m.id])}
                            className="opacity-70 transition-opacity hover:opacity-100"
                          >
                            <Check size={12} />
                          </button>
                        )}
                        <button
                          title="删除"
                          onClick={() => setDelTarget(m)}
                          className="opacity-70 transition-opacity hover:opacity-100"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </div>

      {/* 写短信 */}
      <Modal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        title="写短信"
        footer={
          <>
            <Button variant="secondary" onClick={() => setComposeOpen(false)}>
              取消
            </Button>
            <Button icon={<Send size={13} />} loading={sending} onClick={sendSms}>
              发送
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="接收号码">
            <Input
              value={composeTo}
              onChange={(e) => setComposeTo(e.target.value)}
              placeholder="如 10086"
            />
          </Field>
          <Field
            label="内容"
            hint={`${composeText.length} 字 · ${encodeType === 'UNICODE' ? 'Unicode 编码（70 字/条）' : 'GSM7 编码（160 字/条）'}`}
          >
            <textarea
              className={`${inputCls} min-h-28 resize-y`}
              value={composeText}
              onChange={(e) => setComposeText(e.target.value)}
              placeholder="输入短信内容…"
            />
          </Field>
        </div>
      </Modal>

      {/* 删除确认 */}
      <ConfirmModal
        open={delTarget != null}
        onClose={() => setDelTarget(null)}
        onConfirm={deleteOne}
        title="删除短信"
        danger
        loading={deleting}
        confirmText="删除"
        message={
          <>
            确定删除来自 <span className="font-semibold">{delTarget?.number}</span> 的这条短信吗？
            <span className="mt-1 block break-all text-xs text-slate-400">{delTarget?.content}</span>
          </>
        }
      />
    </div>
  )
}

/* ================= Tab 2：转发配置 ================= */

const DEST_LABELS: Record<string, string> = {
  telegram: 'Telegram',
  webhook: 'Webhook',
  sms: '短信转发',
  ntfy: 'Ntfy',
  discord: 'Discord',
  slack: 'Slack',
}

const DEST_TONES: Record<string, 'brand' | 'blue' | 'green' | 'purple' | 'yellow' | 'slate'> = {
  telegram: 'blue',
  webhook: 'purple',
  sms: 'green',
  ntfy: 'yellow',
  discord: 'brand',
  slack: 'slate',
}

function describeFilter(f: SmsFilter): string {
  switch (f.type) {
    case 'all':
      return '全部短信'
    case 'sender':
      return `发件人匹配：${f.patterns.join('、') || '—'}`
    case 'content':
      return `内容关键词：${f.keywords.join('、') || '—'}`
    case 'sender_and_content':
      return `发件人：${f.patterns.join('、') || '—'}，且含关键词：${f.keywords.join('、') || '—'}`
  }
}

function describeDest(d: ForwardDestination): string {
  switch (d.type) {
    case 'telegram':
      return `Telegram · Chat ${d.chat_id}`
    case 'webhook':
      return `${d.method ?? 'POST'} ${d.url}`
    case 'sms':
      return `转发至号码 ${d.forward_number}`
    case 'ntfy':
      return `${d.url} / ${d.topic}`
    case 'discord':
      return 'Discord Webhook'
    case 'slack':
      return 'Slack Webhook'
  }
}

interface RuleForm {
  name: string
  enabled: boolean
  filterType: SmsFilter['type']
  patterns: string
  keywords: string
  destType: ForwardDestination['type']
  botToken: string
  chatId: string
  silent: boolean
  url: string
  method: string
  headers: string
  forwardNumber: string
  topic: string
  token: string
  webhookUrl: string
}

function initRuleForm(rule: ForwardRule | null): RuleForm {
  const form: RuleForm = {
    name: '',
    enabled: true,
    filterType: 'all',
    patterns: '',
    keywords: '',
    destType: 'telegram',
    botToken: '',
    chatId: '',
    silent: false,
    url: '',
    method: 'POST',
    headers: '',
    forwardNumber: '',
    topic: '',
    token: '',
    webhookUrl: '',
  }
  if (!rule) return form
  form.name = rule.name
  form.enabled = rule.enabled
  form.filterType = rule.filter.type
  const f = rule.filter
  if (f.type === 'sender' || f.type === 'sender_and_content') form.patterns = f.patterns.join(', ')
  if (f.type === 'content' || f.type === 'sender_and_content') form.keywords = f.keywords.join(', ')
  const d = rule.destination
  form.destType = d.type
  switch (d.type) {
    case 'telegram':
      form.botToken = d.bot_token
      form.chatId = d.chat_id
      form.silent = d.silent ?? false
      break
    case 'webhook':
      form.url = d.url
      form.method = d.method ?? 'POST'
      form.headers = (d.headers ?? []).map((h) => `${h.name}: ${h.value}`).join('\n')
      break
    case 'sms':
      form.forwardNumber = d.forward_number
      break
    case 'ntfy':
      form.url = d.url
      form.topic = d.topic
      form.token = d.token ?? ''
      break
    case 'discord':
    case 'slack':
      form.webhookUrl = d.webhook_url
      break
  }
  return form
}

function splitList(s: string): string[] {
  return s
    .split(/[,，]/)
    .map((x) => x.trim())
    .filter(Boolean)
}

function buildFilter(form: RuleForm): SmsFilter {
  switch (form.filterType) {
    case 'sender':
      return { type: 'sender', patterns: splitList(form.patterns) }
    case 'content':
      return { type: 'content', keywords: splitList(form.keywords) }
    case 'sender_and_content':
      return { type: 'sender_and_content', patterns: splitList(form.patterns), keywords: splitList(form.keywords) }
    default:
      return { type: 'all' }
  }
}

function buildDestination(form: RuleForm): ForwardDestination | null {
  switch (form.destType) {
    case 'telegram':
      if (!form.botToken.trim() || !form.chatId.trim()) return null
      return { type: 'telegram', bot_token: form.botToken.trim(), chat_id: form.chatId.trim(), silent: form.silent }
    case 'webhook': {
      if (!form.url.trim()) return null
      const headers: HttpHeader[] = form.headers
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const idx = l.indexOf(':')
          return idx > 0
            ? { name: l.slice(0, idx).trim(), value: l.slice(idx + 1).trim() }
            : { name: l, value: '' }
        })
      return { type: 'webhook', url: form.url.trim(), method: form.method, headers }
    }
    case 'sms':
      if (!form.forwardNumber.trim()) return null
      return { type: 'sms', forward_number: form.forwardNumber.trim() }
    case 'ntfy':
      if (!form.url.trim() || !form.topic.trim()) return null
      return {
        type: 'ntfy',
        url: form.url.trim(),
        topic: form.topic.trim(),
        ...(form.token.trim() ? { token: form.token.trim() } : {}),
      }
    case 'discord':
      if (!form.webhookUrl.trim()) return null
      return { type: 'discord', webhook_url: form.webhookUrl.trim() }
    case 'slack':
      if (!form.webhookUrl.trim()) return null
      return { type: 'slack', webhook_url: form.webhookUrl.trim() }
  }
}

function RuleModal({
  open,
  onClose,
  rule,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  rule: ForwardRule | null
  onSaved: () => void
}) {
  const [form, setForm] = useState<RuleForm>(() => initRuleForm(rule))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) setForm(initRuleForm(rule))
  }, [open, rule])

  const set = <K extends keyof RuleForm>(k: K, v: RuleForm[K]) => setForm((p) => ({ ...p, [k]: v }))

  const submit = async () => {
    if (!form.name.trim()) return toast.error('请填写规则名称')
    const destination = buildDestination(form)
    if (!destination) return toast.error('请完善转发目标的必填字段')
    const payload = { name: form.name.trim(), enabled: form.enabled, filter: buildFilter(form), destination }
    setSaving(true)
    try {
      if (rule) await api.put('/api/sms/forward/rules', { id: rule.id, ...payload })
      else await api.post('/api/sms/forward/rules', payload)
      toast.success(rule ? '规则已更新' : '规则已创建')
      onSaved()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  const needPatterns = form.filterType === 'sender' || form.filterType === 'sender_and_content'
  const needKeywords = form.filterType === 'content' || form.filterType === 'sender_and_content'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={rule ? `编辑规则「${rule.name}」` : '新建转发规则'}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button loading={saving} onClick={submit}>
            保存
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="规则名称">
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="如：验证码转发" />
          </Field>
          <Field label="启用规则" inline>
            <span />
            <Toggle checked={form.enabled} onChange={(v) => set('enabled', v)} />
          </Field>
        </div>

        <Field label="过滤条件">
          <Select value={form.filterType} onChange={(e) => set('filterType', e.target.value as SmsFilter['type'])}>
            <option value="all">全部短信</option>
            <option value="sender">按发件人匹配</option>
            <option value="content">按内容关键词</option>
            <option value="sender_and_content">发件人 + 关键词</option>
          </Select>
        </Field>
        {needPatterns && (
          <Field label="发件人匹配（多个用逗号分隔）">
            <Input value={form.patterns} onChange={(e) => set('patterns', e.target.value)} placeholder="如：10086, 1069" />
          </Field>
        )}
        {needKeywords && (
          <Field label="内容关键词（多个用逗号分隔）">
            <Input value={form.keywords} onChange={(e) => set('keywords', e.target.value)} placeholder="如：验证码, 余额" />
          </Field>
        )}

        <Field label="转发目标">
          <Select value={form.destType} onChange={(e) => set('destType', e.target.value as ForwardDestination['type'])}>
            <option value="telegram">Telegram</option>
            <option value="webhook">Webhook</option>
            <option value="sms">短信转发</option>
            <option value="ntfy">Ntfy</option>
            <option value="discord">Discord</option>
            <option value="slack">Slack</option>
          </Select>
        </Field>

        {form.destType === 'telegram' && (
          <>
            <Field label="Bot Token">
              <Input value={form.botToken} onChange={(e) => set('botToken', e.target.value)} placeholder="123456:ABC-DEF…" />
            </Field>
            <Field label="Chat ID">
              <Input value={form.chatId} onChange={(e) => set('chatId', e.target.value)} placeholder="如：123456789" />
            </Field>
            <Field label="静默通知（不弹提醒）" inline>
              <span />
              <Toggle checked={form.silent} onChange={(v) => set('silent', v)} />
            </Field>
          </>
        )}
        {form.destType === 'webhook' && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <Field label="URL">
                  <Input value={form.url} onChange={(e) => set('url', e.target.value)} placeholder="https://example.com/hook" />
                </Field>
              </div>
              <Field label="Method">
                <Select value={form.method} onChange={(e) => set('method', e.target.value)}>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                </Select>
              </Field>
            </div>
            <Field label="自定义请求头（每行一条，格式 Name: Value，可留空）">
              <textarea
                className={`${inputCls} min-h-20 resize-y font-mono text-xs`}
                value={form.headers}
                onChange={(e) => set('headers', e.target.value)}
                placeholder={'Authorization: Bearer xxx\nX-Custom: value'}
              />
            </Field>
          </>
        )}
        {form.destType === 'sms' && (
          <Field label="转发到号码">
            <Input value={form.forwardNumber} onChange={(e) => set('forwardNumber', e.target.value)} placeholder="如：13800138000" />
          </Field>
        )}
        {form.destType === 'ntfy' && (
          <>
            <Field label="服务器 URL">
              <Input value={form.url} onChange={(e) => set('url', e.target.value)} placeholder="https://ntfy.sh" />
            </Field>
            <Field label="Topic">
              <Input value={form.topic} onChange={(e) => set('topic', e.target.value)} placeholder="如：u60-sms" />
            </Field>
            <Field label="访问 Token（可选）">
              <Input value={form.token} onChange={(e) => set('token', e.target.value)} placeholder="tk_…（可留空）" />
            </Field>
          </>
        )}
        {(form.destType === 'discord' || form.destType === 'slack') && (
          <Field label="Webhook URL">
            <Input value={form.webhookUrl} onChange={(e) => set('webhookUrl', e.target.value)} placeholder="https://…" />
          </Field>
        )}
      </div>
    </Modal>
  )
}

function ForwardConfigTab() {
  const { data, loading, error, refresh } = useAsync<{ config: ForwardConfig; last_forwarded_id: number }>(
    () => api.get('/api/sms/forward/config'),
    [],
  )
  const config = data?.config ?? null

  const [draft, setDraft] = useState<{
    enabled: boolean
    interval: string
    markRead: boolean
    deleteAfter: boolean
  } | null>(null)
  const [savingCfg, setSavingCfg] = useState(false)

  useEffect(() => {
    if (config && !draft) {
      setDraft({
        enabled: config.enabled,
        interval: String(config.poll_interval_secs ?? 30),
        markRead: config.mark_read_after_forward,
        deleteAfter: config.delete_after_forward,
      })
    }
  }, [config, draft])

  const [ruleModalOpen, setRuleModalOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<ForwardRule | null>(null)
  const [delRule, setDelRule] = useState<ForwardRule | null>(null)
  const [deletingRule, setDeletingRule] = useState(false)
  const [testing, setTesting] = useState<number | null>(null)
  const [toggling, setToggling] = useState<number | null>(null)

  const saveConfig = async () => {
    if (!draft) return
    const interval = parseInt(draft.interval, 10)
    if (!Number.isFinite(interval) || interval < 10) return toast.error('轮询间隔需为 ≥ 10 的数字（秒）')
    setSavingCfg(true)
    try {
      await api.put('/api/sms/forward/config', {
        enabled: draft.enabled,
        poll_interval_secs: interval,
        mark_read_after_forward: draft.markRead,
        delete_after_forward: draft.deleteAfter,
      })
      toast.success('配置已保存')
      refresh()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSavingCfg(false)
    }
  }

  const toggleRule = async (rule: ForwardRule, enabled: boolean) => {
    setToggling(rule.id)
    try {
      await api.put('/api/sms/forward/rules/toggle', { id: rule.id, enabled })
      refresh()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setToggling(null)
    }
  }

  const deleteRule = async () => {
    if (!delRule) return
    setDeletingRule(true)
    try {
      await api.delete('/api/sms/forward/rules', { id: delRule.id })
      toast.success('规则已删除')
      setDelRule(null)
      refresh()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setDeletingRule(false)
    }
  }

  const testRule = async (rule: ForwardRule) => {
    setTesting(rule.id)
    try {
      await api.post('/api/sms/forward/test', { destination: rule.destination })
      toast.success('测试消息已发送')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setTesting(null)
    }
  }

  if (loading && !config) return <Spinner text="加载转发配置…" />
  if (error && !config) return <ErrorBox error={error} onRetry={refresh} />

  const rules = config?.rules ?? []

  return (
    <div className="space-y-3">
      {/* 全局配置 */}
      <Card
        title="全局配置"
        icon={<Settings2 size={15} />}
        extra={
          <Button size="sm" loading={savingCfg} onClick={saveConfig}>
            保存配置
          </Button>
        }
      >
        {draft && (
          <div className="divide-y divide-slate-100 dark:divide-white/5">
            <Field label="启用短信转发" inline>
              <span />
              <Toggle checked={draft.enabled} onChange={(v) => setDraft({ ...draft, enabled: v })} />
            </Field>
            <Field label="轮询间隔（秒，≥ 10）" inline>
              <span />
              <Input
                className="w-24 text-right"
                value={draft.interval}
                onChange={(e) => setDraft({ ...draft, interval: e.target.value })}
              />
            </Field>
            <Field label="转发后标记已读" inline>
              <span />
              <Toggle checked={draft.markRead} onChange={(v) => setDraft({ ...draft, markRead: v })} />
            </Field>
            <Field label="转发后删除短信" inline>
              <span />
              <Toggle checked={draft.deleteAfter} onChange={(v) => setDraft({ ...draft, deleteAfter: v })} />
            </Field>
          </div>
        )}
        {config && draft && (
          <p className="mt-2 text-xs text-slate-400">
            转发状态：{config.enabled ? <Badge tone="green">运行中</Badge> : <Badge tone="slate">已停用</Badge>}
            <span className="tabular ml-2">已处理到 ID {data?.last_forwarded_id ?? 0}</span>
          </p>
        )}
      </Card>

      {/* 规则列表 */}
      <Card
        title="转发规则"
        icon={<Forward size={15} />}
        extra={
          <Button
            size="sm"
            icon={<Plus size={13} />}
            onClick={() => {
              setEditingRule(null)
              setRuleModalOpen(true)
            }}
          >
            新建规则
          </Button>
        }
      >
        {rules.length === 0 ? (
          <EmptyState text="暂无转发规则" icon={<Forward size={22} />} />
        ) : (
          <div className="space-y-2">
            {rules.map((rule) => (
              <div
                key={rule.id}
                className="rounded-xl border border-slate-200/70 p-3 dark:border-white/5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                      {rule.name}
                    </span>
                    <Badge tone={DEST_TONES[rule.destination.type] ?? 'slate'}>
                      {DEST_LABELS[rule.destination.type] ?? rule.destination.type}
                    </Badge>
                  </div>
                  <Toggle
                    checked={rule.enabled}
                    loading={toggling === rule.id}
                    onChange={(v) => toggleRule(rule, v)}
                  />
                </div>
                <div className="mt-2 space-y-1 text-xs text-slate-500 dark:text-slate-400">
                  <p className="flex items-center gap-1.5">
                    <ListFilter size={12} className="shrink-0" />
                    {describeFilter(rule.filter)}
                  </p>
                  <p className="flex items-center gap-1.5 break-all">
                    <Forward size={12} className="shrink-0" />
                    {describeDest(rule.destination)}
                  </p>
                </div>
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Play size={12} />}
                    loading={testing === rule.id}
                    onClick={() => testRule(rule)}
                  >
                    测试
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Pencil size={12} />}
                    onClick={() => {
                      setEditingRule(rule)
                      setRuleModalOpen(true)
                    }}
                  >
                    编辑
                  </Button>
                  <Button size="sm" variant="danger" icon={<Trash2 size={12} />} onClick={() => setDelRule(rule)}>
                    删除
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <RuleModal
        open={ruleModalOpen}
        onClose={() => setRuleModalOpen(false)}
        rule={editingRule}
        onSaved={() => {
          setRuleModalOpen(false)
          refresh()
        }}
      />

      <ConfirmModal
        open={delRule != null}
        onClose={() => setDelRule(null)}
        onConfirm={deleteRule}
        title="删除转发规则"
        danger
        loading={deletingRule}
        confirmText="删除"
        message={
          <>
            确定删除规则 <span className="font-semibold">「{delRule?.name}」</span> 吗？删除后匹配的短信将不再转发。
          </>
        }
      />
    </div>
  )
}

/* ================= Tab 3：转发日志 ================= */

function ForwardLogTab() {
  const { data, loading, error, refresh } = useAsync<ForwardLogEntry[]>(() => api.get('/api/sms/forward/log'), [])
  const [clearOpen, setClearOpen] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [retrying, setRetrying] = useState<number | null>(null)

  const entries = data ?? []

  const retry = async (index: number) => {
    setRetrying(index)
    try {
      await api.post('/api/sms/forward/retry', { index })
      toast.success('重发成功')
      refresh()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setRetrying(null)
    }
  }

  const clearLog = async () => {
    setClearing(true)
    try {
      await api.post('/api/sms/forward/log/clear')
      toast.success('日志已清空')
      setClearOpen(false)
      refresh()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="space-y-3">
      <Card
        title="转发日志"
        icon={<History size={15} />}
        extra={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} onClick={refresh}>
              刷新
            </Button>
            {entries.length > 0 && (
              <Button size="sm" variant="danger" icon={<Trash2 size={13} />} onClick={() => setClearOpen(true)}>
                清空
              </Button>
            )}
          </div>
        }
        pad={false}
      >
        {loading && !data ? (
          <Spinner text="加载日志…" />
        ) : error && !data ? (
          <ErrorBox error={error} onRetry={refresh} />
        ) : entries.length === 0 ? (
          <EmptyState text="暂无转发记录" icon={<History size={22} />} />
        ) : (
          <div className="max-h-[560px] divide-y divide-slate-100 overflow-y-auto dark:divide-white/5">
            {entries.map((e, idx) => (
              <div key={`${e.timestamp}-${e.sms_id}-${idx}`} className="flex items-start gap-3 px-4 py-3">
                {e.success ? (
                  <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-500" />
                ) : (
                  <XCircle size={16} className="mt-0.5 shrink-0 text-red-500" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                      {e.sender || '未知号码'}
                    </span>
                    <Badge tone="brand">{e.rule_name}</Badge>
                    <Badge tone={DEST_TONES[e.destination_type] ?? 'slate'}>
                      {DEST_LABELS[e.destination_type] ?? e.destination_type}
                    </Badge>
                    {e.success ? <Badge tone="green">成功</Badge> : <Badge tone="red">失败</Badge>}
                    <span className="tabular ml-auto text-xs text-slate-400">{fmtMsgTime(e.timestamp)}</span>
                  </div>
                  {e.content_preview && (
                    <p className="mt-1 break-all text-xs text-slate-500 dark:text-slate-400">{e.content_preview}</p>
                  )}
                  {e.error && <p className="mt-1 break-all text-xs text-red-500">{e.error}</p>}
                  {!e.success && (
                    <Button
                      className="mt-2"
                      size="sm"
                      variant="secondary"
                      icon={<RefreshCw size={12} />}
                      loading={retrying === idx}
                      onClick={() => retry(idx)}
                    >
                      重试
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <ConfirmModal
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        onConfirm={clearLog}
        title="清空转发日志"
        danger
        loading={clearing}
        confirmText="清空"
        message={`确定清空全部 ${entries.length} 条转发日志吗？此操作不可恢复。`}
      />
    </div>
  )
}

/* ================= 页面 ================= */

export default function Sms() {
  const [tab, setTab] = useState('messages')

  return (
    <div className="space-y-4">
      <PageHeader title="短信" desc="短信收发 · 自动转发 · 转发记录" />
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'messages', label: '消息', icon: <MessageSquare size={14} /> },
          { key: 'forward', label: '转发配置', icon: <Forward size={14} /> },
          { key: 'log', label: '转发日志', icon: <History size={14} /> },
        ]}
      />
      {tab === 'messages' && <MessagesTab />}
      {tab === 'forward' && <ForwardConfigTab />}
      {tab === 'log' && <ForwardLogTab />}
    </div>
  )
}
