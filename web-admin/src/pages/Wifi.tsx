import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Wifi as WifiIcon, Users, Eye, EyeOff, RefreshCw, Save, ShieldCheck } from 'lucide-react'
import { api, fetchAll } from '../lib/api'
import { useAsync } from '../lib/hooks'
import { num, num0, fmtUptime } from '../lib/format'
import {
  PageHeader,
  Card,
  Badge,
  Button,
  Field,
  Input,
  Select,
  Toggle,
  Spinner,
  ErrorBox,
  toast,
} from '../components/ui'

/* ---------- 工具 ---------- */

function str(v: unknown): string {
  return v == null ? '' : String(v)
}

function asBool(v: unknown): boolean {
  if (typeof v === 'string') return v === '1' || v.toLowerCase() === 'true' || v.toLowerCase() === 'on'
  if (typeof v === 'number') return v !== 0
  return v === true
}

interface Opt {
  value: string
  label: string
}

/** 若当前值不在选项中则追加，保证 Select 能正确显示设备原值 */
function withCurrent(options: Opt[], current: string): Opt[] {
  if (current && !options.some((o) => o.value === current)) {
    return [...options, { value: current, label: `当前（${current}）` }]
  }
  return options
}

function normChannel(v: unknown): string {
  const s = str(v)
  return s === '' || s === '0' ? 'auto' : s
}

/* ---------- 选项（以 iOS WiFi 页面为准） ---------- */

const ENC_OPTIONS: Opt[] = [
  { value: 'none', label: '无加密（开放）' },
  { value: 'psk+tkip', label: 'WPA-PSK / TKIP' },
  { value: 'psk+ccmp', label: 'WPA-PSK / AES' },
  { value: 'psk2+ccmp', label: 'WPA2-PSK / AES' },
  { value: 'psk-mixed+ccmp', label: 'WPA / WPA2 混合' },
  { value: 'sae', label: 'WPA3-SAE' },
  { value: 'sae-mixed', label: 'WPA2 / WPA3 混合' },
]

const CH_2G: Opt[] = [
  { value: 'auto', label: '自动' },
  ...Array.from({ length: 13 }, (_, i) => ({ value: String(i + 1), label: `信道 ${i + 1}` })),
]

const CH_5G: Opt[] = [
  { value: 'auto', label: '自动' },
  ...['36', '40', '44', '48', '52', '56', '60', '64', '100', '104', '108', '112', '116', '120', '124', '128', '132', '136', '140', '149', '153', '157', '161', '165'].map(
    (v) => ({ value: v, label: `信道 ${v}` }),
  ),
]

const HT_2G: Opt[] = [
  { value: 'auto', label: '自动' },
  { value: 'EHT20', label: '20 MHz' },
  { value: 'EHT40', label: '40 MHz' },
]

const HT_5G: Opt[] = [
  { value: 'auto', label: '自动' },
  { value: 'EHT20', label: '20 MHz' },
  { value: 'EHT40', label: '40 MHz' },
  { value: 'EHT80', label: '80 MHz' },
  { value: 'EHT160', label: '160 MHz' },
]

const TX_OPTIONS: Opt[] = [
  { value: '25', label: '25%' },
  { value: '50', label: '50%' },
  { value: '75', label: '75%' },
  { value: '100', label: '100%' },
]

const GUEST_TIME_OPTIONS: Opt[] = [
  { value: '0', label: '不限时长' },
  { value: '30', label: '30 分钟' },
  { value: '60', label: '1 小时' },
  { value: '120', label: '2 小时' },
  { value: '240', label: '4 小时' },
  { value: '480', label: '8 小时' },
  { value: '720', label: '12 小时' },
  { value: '1440', label: '24 小时' },
]

/* ---------- 密码输入框（眼睛图标切换可见） ---------- */

function PasswordInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <Input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pr-9"
        autoComplete="off"
      />
      <button
        type="button"
        title={show ? '隐藏密码' : '显示密码'}
        onClick={() => setShow(!show)}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
      >
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  )
}

/* ---------- 频段卡片 ---------- */

interface BandFields {
  ssid: string
  key: string
  enc: string
  hidden: boolean
  channel: string
  htmode: string
  txpower: string
}

function BandSection({
  title,
  icon,
  enabled,
  fields,
  actualChannel,
  actualBw,
  channelOptions,
  htOptions,
  radioBusy,
  saving,
  onPatch,
  onToggleRadio,
  onSave,
}: {
  title: string
  icon: ReactNode
  enabled: boolean
  fields: BandFields
  actualChannel: string
  actualBw: string
  channelOptions: Opt[]
  htOptions: Opt[]
  radioBusy: boolean
  saving: boolean
  onPatch: (p: Partial<BandFields>) => void
  onToggleRadio: (v: boolean) => void
  onSave: () => void
}) {
  const encOpts = useMemo(() => withCurrent(ENC_OPTIONS, fields.enc), [fields.enc])
  const chOpts = useMemo(() => withCurrent(channelOptions, fields.channel), [channelOptions, fields.channel])
  const htOpts = useMemo(() => withCurrent(htOptions, fields.htmode), [htOptions, fields.htmode])
  const txOpts = useMemo(() => withCurrent(TX_OPTIONS, fields.txpower), [fields.txpower])

  return (
    <Card
      title={title}
      icon={icon}
      extra={
        <span className="flex items-center gap-2">
          <span className="text-xs text-slate-400">{enabled ? '已启用' : '已停用'}</span>
          <Toggle checked={enabled} loading={radioBusy} onChange={onToggleRadio} />
        </span>
      }
    >
      <div className="space-y-3">
        <Field label="SSID">
          <Input value={fields.ssid} onChange={(e) => onPatch({ ssid: e.target.value })} maxLength={32} />
        </Field>
        <Field label="密码" hint={fields.enc === 'none' ? '当前为开放网络，无需密码' : 'WPA 密码需 8-63 位'}>
          <PasswordInput value={fields.key} onChange={(v) => onPatch({ key: v })} placeholder="8-63 位" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="加密方式">
            <Select value={fields.enc} onChange={(e) => onPatch({ enc: e.target.value })}>
              {encOpts.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="信道"
            hint={actualChannel ? `实际：信道 ${actualChannel}${actualBw ? ` · ${actualBw}` : ''}` : undefined}
          >
            <Select value={fields.channel} onChange={(e) => onPatch({ channel: e.target.value })}>
              {chOpts.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="频宽">
            <Select value={fields.htmode} onChange={(e) => onPatch({ htmode: e.target.value })}>
              {htOpts.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="发射功率">
            <Select value={fields.txpower} onChange={(e) => onPatch({ txpower: e.target.value })}>
              {txOpts.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="隐藏网络（不广播 SSID）" inline>
          <Toggle checked={fields.hidden} onChange={(v) => onPatch({ hidden: v })} />
        </Field>
        <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-white/5">
          <span className="text-xs text-slate-400">保存后 WiFi 将重新加载，连接可能短暂中断</span>
          <Button size="sm" icon={<Save size={13} />} loading={saving} onClick={onSave}>
            保存
          </Button>
        </div>
      </div>
    </Card>
  )
}

/* ---------- 主页面 ---------- */

interface GuestFields {
  enabled: boolean
  ssid: string
  key: string
  enc: string
  hidden: boolean
  isolate: boolean
  time: string
}

export default function WifiPage() {
  const { data, error, loading, refresh } = useAsync(() =>
    fetchAll({
      status: () => api.get('/api/wifi/status'),
      guest: () => api.get('/api/wifi/guest'),
    }),
  )
  const st = data?.status
  const g = data?.guest

  /* ----- 全局开关 ----- */
  const [globalBusy, setGlobalBusy] = useState<string | null>(null)
  const toggleGlobal = async (key: 'wifi_onoff' | 'wifi6_switch', v: boolean) => {
    setGlobalBusy(key)
    try {
      await api.put('/api/wifi/settings', { [key]: v ? '1' : '0' })
      toast.success(v ? '已开启' : '已关闭')
      if (key === 'wifi_onoff' && !v) toast.info('WiFi 已关闭，请使用有线/其他方式连接管理')
      await refresh()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setGlobalBusy(null)
    }
  }

  /* ----- 频段表单 ----- */
  const [f2, setF2] = useState<BandFields | null>(null)
  const [f5, setF5] = useState<BandFields | null>(null)
  useEffect(() => {
    if (!st) return
    setF2((prev) =>
      prev ?? {
        ssid: str(st.ssid_2g),
        key: str(st.key_2g),
        enc: str(st.encryption_2g),
        hidden: asBool(st.hidden_2g),
        channel: normChannel(st.channel_2g),
        htmode: str(st.htmode_2g),
        txpower: str(st.txpower_2g) || '100',
      },
    )
    setF5((prev) =>
      prev ?? {
        ssid: str(st.ssid_5g),
        key: str(st.key_5g),
        enc: str(st.encryption_5g),
        hidden: asBool(st.hidden_5g),
        channel: normChannel(st.channel_5g),
        htmode: str(st.htmode_5g),
        txpower: str(st.txpower_5g) || '100',
      },
    )
  }, [st])

  const [radioBusy, setRadioBusy] = useState<string | null>(null)
  const toggleRadio = async (band: '2g' | '5g', enabled: boolean) => {
    setRadioBusy(band)
    try {
      await api.put('/api/wifi/settings', {
        [band === '2g' ? 'radio2_disabled' : 'radio5_disabled']: enabled ? '0' : '1',
      })
      toast.success(enabled ? '频段已启用' : '频段已停用')
      await refresh()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setRadioBusy(null)
    }
  }

  const [bandSaving, setBandSaving] = useState<string | null>(null)
  const saveBand = async (band: '2g' | '5g') => {
    const f = band === '2g' ? f2 : f5
    if (!f) return
    setBandSaving(band)
    const p = band === '2g' ? '2g' : '5g'
    try {
      await api.put('/api/wifi/settings', {
        [`ssid_${p}`]: f.ssid,
        [`key_${p}`]: f.key,
        [`encryption_${p}`]: f.enc,
        [`hidden_${p}`]: f.hidden ? '1' : '0',
        [`channel_${p}`]: f.channel,
        [`htmode_${p}`]: f.htmode,
        [`txpower_${p}`]: f.txpower,
      })
      toast.success('已保存，WiFi 重新加载中')
      toast.info('连接可能短暂中断，请稍候重连')
      await refresh()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBandSaving(null)
    }
  }

  /* ----- 访客网络 ----- */
  const [gf, setGf] = useState<GuestFields | null>(null)
  useEffect(() => {
    if (!g) return
    setGf((prev) =>
      prev ?? {
        enabled: str(g.disabled_2g) !== '1',
        ssid: str(g.ssid),
        key: str(g.key),
        enc: str(g.encryption),
        hidden: asBool(g.hidden),
        isolate: asBool(g.isolate),
        time: str(g.guest_active_time) || '0',
      },
    )
  }, [g])

  const [guestBusy, setGuestBusy] = useState(false)
  const [guestSaving, setGuestSaving] = useState(false)
  const saveGuest = async (patch: Partial<Record<string, string>>, silent = false) => {
    await api.put('/api/wifi/guest', patch)
    if (!silent) {
      toast.success('访客网络已保存')
      toast.info('WiFi 重新加载中，连接可能短暂中断')
    }
  }
  const toggleGuest = async (enabled: boolean) => {
    setGuestBusy(true)
    try {
      await saveGuest({ guest_disabled: enabled ? '0' : '1' }, true)
      toast.success(enabled ? '访客网络已开启' : '访客网络已关闭')
      setGf((prev) => (prev ? { ...prev, enabled } : prev))
      await refresh()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setGuestBusy(false)
    }
  }
  const submitGuest = async () => {
    if (!gf) return
    setGuestSaving(true)
    try {
      await saveGuest({
        guest_ssid: gf.ssid,
        guest_key: gf.key,
        guest_encryption: gf.enc,
        guest_hidden: gf.hidden ? '1' : '0',
        guest_isolate: gf.isolate ? '1' : '0',
        guest_active_time: gf.time,
      })
      await refresh()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setGuestSaving(false)
    }
  }

  if (loading) return <Spinner />
  if (error) return <ErrorBox error={error} onRetry={refresh} />

  const remaining = num(g?.remaining_seconds)

  return (
    <div className="space-y-4">
      <PageHeader
        title="WiFi 设置"
        desc="2.4G / 5G 双频与访客网络管理"
        extra={
          <Button size="sm" variant="secondary" icon={<RefreshCw size={13} />} onClick={refresh}>
            刷新
          </Button>
        }
      />

      {/* 全局开关 */}
      <Card title="无线总览" icon={<WifiIcon size={15} />}>
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <Field label="WiFi 总开关" inline>
            <Toggle
              checked={asBool(st?.wifi_onoff)}
              loading={globalBusy === 'wifi_onoff'}
              onChange={(v) => toggleGlobal('wifi_onoff', v)}
            />
          </Field>
          <Field label="双频合一（WiFi 7 MLO）" inline>
            <Toggle
              checked={asBool(st?.wifi6_switch)}
              loading={globalBusy === 'wifi6_switch'}
              onChange={(v) => toggleGlobal('wifi6_switch', v)}
            />
          </Field>
          <span className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <Users size={14} />
            2.4G <Badge tone="brand">{st?.clients_2g ?? '--'}</Badge>
            5G <Badge tone="brand">{st?.clients_5g ?? '--'}</Badge>
            共 <Badge tone="green">{st?.clients_total ?? '--'}</Badge>
          </span>
        </div>
      </Card>

      {/* 双频设置 */}
      <div className="grid items-start gap-3 lg:grid-cols-2">
        {f2 && (
          <BandSection
            title="2.4GHz 网络"
            icon={<Badge tone="blue">2.4G</Badge>}
            enabled={!asBool(st?.radio2_disabled)}
            fields={f2}
            actualChannel={str(st?.actual_channel_2g)}
            actualBw={str(st?.actual_bw_2g)}
            channelOptions={CH_2G}
            htOptions={HT_2G}
            radioBusy={radioBusy === '2g'}
            saving={bandSaving === '2g'}
            onPatch={(p) => setF2({ ...f2, ...p })}
            onToggleRadio={(v) => toggleRadio('2g', v)}
            onSave={() => saveBand('2g')}
          />
        )}
        {f5 && (
          <BandSection
            title="5GHz 网络"
            icon={<Badge tone="purple">5G</Badge>}
            enabled={!asBool(st?.radio5_disabled)}
            fields={f5}
            actualChannel={str(st?.actual_channel_5g)}
            actualBw={str(st?.actual_bw_5g)}
            channelOptions={CH_5G}
            htOptions={HT_5G}
            radioBusy={radioBusy === '5g'}
            saving={bandSaving === '5g'}
            onPatch={(p) => setF5({ ...f5, ...p })}
            onToggleRadio={(v) => toggleRadio('5g', v)}
            onSave={() => saveBand('5g')}
          />
        )}
      </div>

      {/* 访客网络 */}
      {gf && (
        <Card
          title="访客网络"
          icon={<ShieldCheck size={15} />}
          extra={
            <span className="flex items-center gap-2">
              <span className="text-xs text-slate-400">{gf.enabled ? '已开启' : '已关闭'}</span>
              <Toggle checked={gf.enabled} loading={guestBusy} onChange={toggleGuest} />
            </span>
          }
        >
          <div className="space-y-3">
            {gf.enabled && remaining != null && remaining > 0 && (
              <p className="text-xs text-amber-500">
                访客网络剩余开放时间：{fmtUptime(remaining)}（到期自动关闭）
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="SSID">
                <Input value={gf.ssid} onChange={(e) => setGf({ ...gf, ssid: e.target.value })} maxLength={32} />
              </Field>
              <Field label="密码">
                <PasswordInput value={gf.key} onChange={(v) => setGf({ ...gf, key: v })} placeholder="8-63 位" />
              </Field>
              <Field label="加密方式">
                <Select value={gf.enc} onChange={(e) => setGf({ ...gf, enc: e.target.value })}>
                  {withCurrent(ENC_OPTIONS, gf.enc).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="开放时长">
                <Select value={gf.time} onChange={(e) => setGf({ ...gf, time: e.target.value })}>
                  {withCurrent(GUEST_TIME_OPTIONS, gf.time).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="flex flex-wrap gap-x-8">
              <Field label="隐藏网络" inline>
                <Toggle checked={gf.hidden} onChange={(v) => setGf({ ...gf, hidden: v })} />
              </Field>
              <Field label="客户端隔离" inline>
                <Toggle checked={gf.isolate} onChange={(v) => setGf({ ...gf, isolate: v })} />
              </Field>
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-white/5">
              <span className="text-xs text-slate-400">访客设备无法访问主网络与管理页面</span>
              <Button size="sm" icon={<Save size={13} />} loading={guestSaving} onClick={submitGuest}>
                保存
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
