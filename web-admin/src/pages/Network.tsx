import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Signal as SignalIcon,
  Plane,
  RefreshCw,
  Search,
  Globe,
  Plus,
  Pencil,
  Trash2,
  Network as NetworkIcon,
  ListPlus,
} from 'lucide-react'
import { api, fetchAll } from '../lib/api'
import { useAsync, usePoll } from '../lib/hooks'
import { num } from '../lib/format'
import {
  PageHeader,
  Tabs,
  Card,
  Badge,
  Button,
  Field,
  Input,
  Select,
  Toggle,
  Modal,
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

/* ---------- 数据连接 ---------- */

function DataConnection() {
  const { data, error, loading, refresh } = useAsync(() =>
    fetchAll({
      wwan: () => api.get('/api/modem/data'),
      status: () => api.get('/api/modem/status'),
    }),
  )
  const [busy, setBusy] = useState<'data' | 'air' | 'online' | null>(null)
  const [confirmAir, setConfirmAir] = useState(false)

  const wwan = data?.wwan
  const operateMode = str(data?.status?.operate_mode)
  const airplane = operateMode !== '' && operateMode !== 'ONLINE'
  const dataEnabled = num(wwan?.enable) === 1
  const connectStatus = str(wwan?.connect_status)
  const connected = connectStatus.includes('connected')

  const setMobileData = async (v: boolean) => {
    setBusy('data')
    try {
      await api.put('/api/modem/data', {
        cid: 1,
        connect_mode: num(wwan?.connect_mode) ?? 1,
        roam_enable: num(wwan?.roam_enable) ?? 0,
        enable: v ? 1 : 0,
        ...(v ? {} : { connect_status: 'disconnected' }),
      })
      toast.success(v ? '移动数据已开启' : '移动数据已关闭')
      await refresh()
    } catch (e: any) {
      toast.error(e.message)
      await refresh() // 回滚到设备真实状态
    } finally {
      setBusy(null)
    }
  }

  const setAirplane = async (v: boolean) => {
    setBusy('air')
    try {
      if (v) {
        await api.post('/api/modem/airplane', { operate_mode: 'LPM' })
        toast.success('飞行模式已开启，蜂窝网络已断开')
      } else {
        await api.post('/api/modem/airplane', { operate_mode: 'ONLINE' })
        toast.info('正在恢复网络，信号重连需要数秒…')
      }
      setTimeout(() => refresh(), 3000)
      await refresh()
    } catch (e: any) {
      toast.error(v ? e.message : `${e.message}（如无法恢复，请重启设备）`)
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  const goOnline = async () => {
    setBusy('online')
    try {
      await api.post('/api/modem/online')
      toast.success('已发送重新上线指令，请稍候')
      setTimeout(() => refresh(), 3000)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(null)
    }
  }

  if (loading && !data) return <Spinner />
  if (error && !data) return <ErrorBox error={error} onRetry={refresh} />

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card title="数据连接" icon={<SignalIcon size={15} />}>
        <Field label="移动数据" inline>
          <Toggle checked={dataEnabled} loading={busy === 'data'} onChange={setMobileData} />
        </Field>
        <Field label="飞行模式" inline>
          <Toggle
            checked={airplane}
            loading={busy === 'air'}
            onChange={(v) => (v ? setConfirmAir(true) : setAirplane(false))}
          />
        </Field>
        <dl className="mt-2 divide-y divide-slate-100 dark:divide-white/5">
          <KV
            k="连接状态"
            v={
              connected ? (
                <Badge tone="green">已连接</Badge>
              ) : (
                <Badge tone={dataEnabled ? 'yellow' : 'slate'}>{connectStatus || '未连接'}</Badge>
              )
            }
          />
          <KV k="运行模式" v={operateMode || '--'} mono />
          <KV k="连接模式" v={num(wwan?.connect_mode) === 0 ? '手动拨号' : '自动拨号'} />
          <KV
            k="数据漫游"
            v={truthy(wwan?.roam_enable) ? <Badge tone="blue">已开启</Badge> : '关闭'}
          />
        </dl>
        <div className="mt-3">
          <Button
            variant="secondary"
            icon={<RefreshCw size={13} />}
            loading={busy === 'online'}
            onClick={goOnline}
          >
            重新上线
          </Button>
        </div>
      </Card>

      <Card title="说明" icon={<Plane size={15} />}>
        <ul className="list-inside list-disc space-y-2 text-sm text-slate-500 dark:text-slate-400">
          <li>关闭移动数据会断开蜂窝网络连接，WiFi 与有线连接不受影响。</li>
          <li>
            飞行模式会关闭蜂窝射频。
            <span className="text-amber-500">
              本机固件存在缺陷：关闭飞行模式后若无法恢复网络，需重启设备。
            </span>
          </li>
          <li>“重新上线”用于在网络异常（如注册丢失）后强制调制解调器重新附着网络。</li>
        </ul>
      </Card>

      <ConfirmModal
        open={confirmAir}
        onClose={() => setConfirmAir(false)}
        onConfirm={() => {
          setConfirmAir(false)
          setAirplane(true)
        }}
        title="开启飞行模式"
        danger
        confirmText="开启飞行模式"
        message="开启后蜂窝网络将立即断开，所有依赖移动数据的功能（上网、短信、电话）都会中断。注意：本机固件存在缺陷，关闭飞行模式后可能无法自动恢复，届时需要重启设备。确定开启吗？"
      />
    </div>
  )
}

/* ---------- 网络模式 ---------- */

const NET_SELECT_OPTIONS = [
  { value: 'WL_AND_5G', label: '自动（4G / 5G）' },
  { value: 'LTE_AND_5G', label: '5G NSA（LTE + NR）' },
  { value: 'Only_5G', label: '仅 5G SA' },
  { value: 'Only_LTE', label: '仅 4G LTE' },
  { value: 'WCDMA_AND_LTE', label: '4G + 3G' },
  { value: 'Only_WCDMA', label: '仅 3G' },
]

function NetworkModeSection() {
  const { data, error, loading, refresh } = useAsync(() => api.get('/api/network/signal'))
  const [sel, setSel] = useState('')
  const [busy, setBusy] = useState(false)

  const current = str(data?.net_select)
  const options = useMemo(() => {
    if (current && !NET_SELECT_OPTIONS.some((o) => o.value === current)) {
      return [...NET_SELECT_OPTIONS, { value: current, label: `当前值（${current}）` }]
    }
    return NET_SELECT_OPTIONS
  }, [current])

  useEffect(() => {
    if (current && !sel) setSel(current)
  }, [current, sel])

  const apply = async () => {
    if (!sel || sel === current) return
    setBusy(true)
    try {
      await api.put('/api/modem/network-mode', { net_select: sel })
      toast.success('网络模式已切换，调制解调器将重新注册网络')
      setTimeout(() => refresh(), 4000)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (loading && !data) return <Spinner />
  if (error && !data) return <ErrorBox error={error} onRetry={refresh} />

  return (
    <Card title="网络模式" icon={<NetworkIcon size={15} />}>
      <div className="max-w-sm space-y-3">
        <Field label="首选网络类型" hint="切换后调制解调器会重新搜网注册，期间网络会短暂中断">
          <Select value={sel} onChange={(e) => setSel(e.target.value)}>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex items-center gap-2">
          <Button icon={<NetworkIcon size={13} />} loading={busy} disabled={!sel || sel === current} onClick={apply}>
            应用
          </Button>
          {current && <Badge tone="brand">当前：{options.find((o) => o.value === current)?.label ?? current}</Badge>}
        </div>
      </div>
    </Card>
  )
}

/* ---------- 运营商选择 ---------- */

interface Operator {
  name: string
  mccMnc: string
  rat: string
  status: string
}

function OperatorSection() {
  const [scanning, setScanning] = useState(false)
  const [operators, setOperators] = useState<Operator[] | null>(null)
  const [registering, setRegistering] = useState<string | null>(null)
  const [autoBusy, setAutoBusy] = useState(false)
  const scanAttempts = useRef(0)
  const regAttempts = useRef(0)

  const scan = async () => {
    setScanning(true)
    setOperators(null)
    scanAttempts.current = 0
    try {
      await api.post('/api/modem/scan')
      toast.info('开始扫描可用运营商，通常需要 30~60 秒…')
    } catch (e: any) {
      toast.error(e.message)
      setScanning(false)
    }
  }

  // 轮询扫描状态
  usePoll(
    async () => {
      scanAttempts.current += 1
      try {
        const st = await api.get('/api/modem/scan/status')
        const s = str(st?.m_netselect_status).toLowerCase()
        if (s === 'done' || s === 'complete' || s === '2') {
          const r = await api.get('/api/modem/scan/results')
          const list = Array.isArray(r?.m_netselect_contents) ? r.m_netselect_contents : []
          setOperators(
            list.map((it: any) => ({
              name: str(it?.name) || str(it?.operator_name) || str(it?.mcc_mnc) || '未知运营商',
              mccMnc: str(it?.mcc_mnc) || str(it?.plmn),
              rat: str(it?.rat) || '--',
              status: str(it?.status) || 'available',
            })),
          )
          setScanning(false)
          toast.success(`扫描完成，发现 ${list.length} 个运营商`)
        } else if (scanAttempts.current >= 40) {
          setScanning(false)
          toast.error('扫描超时，请重试')
        }
      } catch {
        if (scanAttempts.current >= 40) {
          setScanning(false)
          toast.error('扫描状态查询失败')
        }
      }
    },
    3000,
    scanning,
  )

  const register = async (op: Operator) => {
    if (!op.mccMnc) {
      toast.error('该运营商缺少 PLMN 信息，无法注册')
      return
    }
    setRegistering(op.mccMnc)
    regAttempts.current = 0
    try {
      await api.post('/api/modem/register', { m_mcc_mnc: op.mccMnc, m_rat: op.rat })
      toast.info(`正在注册到 ${op.name}…`)
    } catch (e: any) {
      toast.error(e.message)
      setRegistering(null)
    }
  }

  // 轮询注册结果
  usePoll(
    async () => {
      regAttempts.current += 1
      try {
        const r = await api.get('/api/modem/register/result')
        const v = str(r?.m_netselect_result).toLowerCase()
        if (v === 'success' || v === '1') {
          toast.success('已成功注册到目标网络')
          setRegistering(null)
        } else if (v === 'fail' || v === '0') {
          toast.error('注册失败，请重试或恢复自动选网')
          setRegistering(null)
        } else if (regAttempts.current >= 20) {
          toast.error('注册超时')
          setRegistering(null)
        }
      } catch {
        if (regAttempts.current >= 20) setRegistering(null)
      }
    },
    3000,
    registering != null,
  )

  const restoreAuto = async () => {
    setAutoBusy(true)
    try {
      await api.put('/api/modem/network-mode', { net_select_mode: 'auto_select' })
      toast.success('已恢复自动选网')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setAutoBusy(false)
    }
  }

  return (
    <Card
      title="运营商选择"
      icon={<Globe size={15} />}
      extra={
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" loading={autoBusy} onClick={restoreAuto}>
            恢复自动
          </Button>
          <Button size="sm" icon={<Search size={13} />} loading={scanning} onClick={scan}>
            {operators ? '重新扫描' : '扫描运营商'}
          </Button>
        </div>
      }
    >
      {scanning && (
        <div className="py-4">
          <Spinner text="正在扫描附近运营商，请保持设备静止…" />
        </div>
      )}
      {!scanning && operators == null && (
        <EmptyState icon={<Search size={22} />} text="点击“扫描运营商”搜索手动注册可用网络" />
      )}
      {!scanning && operators != null && operators.length === 0 && (
        <EmptyState text="未发现可用运营商" />
      )}
      {!scanning && operators != null && operators.length > 0 && (
        <div className="space-y-2">
          {operators.map((op, i) => {
            const isCurrent = op.status === 'current'
            const isForbidden = op.status === 'forbidden'
            return (
              <div
                key={`${op.mccMnc}-${i}`}
                className="flex items-center gap-3 rounded-xl border border-slate-200/70 px-3 py-2.5 dark:border-white/5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                      {op.name}
                    </span>
                    <Badge tone="blue">{op.rat}</Badge>
                    {isCurrent && <Badge tone="green">当前</Badge>}
                    {isForbidden && <Badge tone="red">禁止</Badge>}
                  </div>
                  <div className="tabular mt-0.5 font-mono text-xs text-slate-400">
                    PLMN {op.mccMnc || '--'}
                  </div>
                </div>
                {!isCurrent && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={isForbidden || registering != null}
                    loading={registering === op.mccMnc}
                    onClick={() => register(op)}
                  >
                    注册
                  </Button>
                )}
              </div>
            )
          })}
          <p className="text-xs text-slate-400">
            手动注册后如需恢复，点击右上角“恢复自动”。注册过程中网络会短暂断开。
          </p>
        </div>
      )}
    </Card>
  )
}

/* ---------- APN 管理 ---------- */

interface ApnProfile {
  id: string
  name: string
  apn: string
  pdpType: number
  authMode: number
  username: string
  password: string
  active: boolean
}

const EMPTY_PROFILE: ApnProfile = {
  id: '',
  name: '',
  apn: '',
  pdpType: 3,
  authMode: 0,
  username: '',
  password: '',
  active: false,
}

function parseProfiles(raw: any): ApnProfile[] {
  const list = Array.isArray(raw?.apnListArray) ? raw.apnListArray : []
  return list
    .map((it: any) => ({
      id: str(it?.profileId),
      name: str(it?.profilename),
      apn: str(it?.wanapn),
      pdpType: num(it?.pdpType) ?? 3,
      authMode: num(it?.pppAuthMode) ?? 0,
      username: str(it?.username),
      password: str(it?.password),
      active: truthy(it?.isEnable),
    }))
    .filter((p: ApnProfile) => p.id && (p.name || p.apn))
}

function pdpLabel(t: number): string {
  return t === 1 ? 'IPv4' : t === 2 ? 'IPv6' : 'IPv4v6'
}

function authLabel(t: number): string {
  return t === 1 ? 'PAP' : t === 2 ? 'CHAP' : '无认证'
}

function ApnSection() {
  const { data, error, loading, refresh } = useAsync(() =>
    fetchAll({
      mode: () => api.get('/api/router/apn/mode'),
      profiles: () => api.get('/api/router/apn/profiles'),
      auto: () => api.get('/api/router/apn/auto-profiles'),
    }),
  )
  const [modeBusy, setModeBusy] = useState(false)
  const [actBusy, setActBusy] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<ApnProfile | null>(null)
  const [form, setForm] = useState<ApnProfile>(EMPTY_PROFILE)
  const [saving, setSaving] = useState(false)
  const [delTarget, setDelTarget] = useState<ApnProfile | null>(null)
  const [delBusy, setDelBusy] = useState(false)

  const manual = str(data?.mode?.apn_mode) === '1'
  const profiles = useMemo(() => parseProfiles(data?.profiles), [data])
  const autoProfiles = useMemo(() => parseProfiles(data?.auto), [data])
  const activeAuto = autoProfiles.find((p) => p.active) ?? autoProfiles[0] ?? null

  const setMode = async (m: boolean) => {
    setModeBusy(true)
    try {
      await api.put('/api/router/apn/mode', { apn_mode: m ? 1 : 0 })
      toast.success(m ? '已切换到手动 APN 模式' : '已切换到自动 APN 模式')
      await refresh()
    } catch (e: any) {
      toast.error(e.message)
      await refresh()
    } finally {
      setModeBusy(false)
    }
  }

  const openAdd = () => {
    setEditing(null)
    setForm(EMPTY_PROFILE)
    setModalOpen(true)
  }

  const openEdit = (p: ApnProfile) => {
    setEditing(p)
    setForm({ ...p })
    setModalOpen(true)
  }

  const fillFromAuto = (id: string) => {
    const p = autoProfiles.find((x) => x.id === id)
    if (!p) return
    setForm((f) => ({ ...f, name: p.name || f.name, apn: p.apn, pdpType: p.pdpType }))
  }

  const save = async () => {
    if (!form.name.trim() || !form.apn.trim()) {
      toast.error('名称和 APN 不能为空')
      return
    }
    setSaving(true)
    try {
      const body = {
        profilename: form.name.trim(),
        wanapn: form.apn.trim(),
        pdpType: form.pdpType,
        pppAuthMode: form.authMode,
        username: form.username,
        password: form.password,
      }
      if (editing) {
        await api.put('/api/router/apn/profiles', { profileId: editing.id, ...body })
        toast.success('APN 已更新')
      } else {
        await api.post('/api/router/apn/profiles', body)
        toast.success('APN 已添加')
      }
      setModalOpen(false)
      await refresh()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  const activate = async (p: ApnProfile) => {
    setActBusy(p.id)
    try {
      await api.post('/api/router/apn/profiles/activate', { profileId: p.id })
      toast.success(`已激活「${p.name || p.apn}」，数据连接将重新建立`)
      await refresh()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setActBusy(null)
    }
  }

  const doDelete = async () => {
    if (!delTarget) return
    setDelBusy(true)
    try {
      await api.post('/api/router/apn/profiles/delete', { profileId: delTarget.id })
      toast.success('APN 已删除')
      setDelTarget(null)
      await refresh()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setDelBusy(false)
    }
  }

  if (loading && !data) return <Spinner />
  if (error && !data) return <ErrorBox error={error} onRetry={refresh} />

  return (
    <div className="space-y-3">
      <Card title="APN 模式" icon={<ListPlus size={15} />}>
        <Field label="手动配置 APN" inline>
          <Toggle checked={manual} loading={modeBusy} onChange={setMode} />
        </Field>
        {!manual && (
          <dl className="mt-1 divide-y divide-slate-100 dark:divide-white/5">
            <KV k="当前模式" v={<Badge tone="green">自动</Badge>} />
            <KV
              k="当前 APN"
              v={activeAuto ? `${activeAuto.name || activeAuto.apn}（${activeAuto.apn}）` : '--'}
            />
          </dl>
        )}
        {manual && (
          <p className="mt-1 text-xs text-slate-400">
            手动模式下使用下方自定义 APN 列表；切换 APN 后数据连接会自动重建。
          </p>
        )}
      </Card>

      <Card
        title="APN 列表"
        icon={<ListPlus size={15} />}
        extra={
          <Button size="sm" icon={<Plus size={13} />} onClick={openAdd}>
            新建 APN
          </Button>
        }
      >
        {profiles.length === 0 ? (
          <EmptyState text="暂无自定义 APN，点击右上角新建" />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {profiles.map((p) => (
              <div
                key={p.id}
                className="rounded-xl border border-slate-200/70 p-3 dark:border-white/5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                    {p.name || p.apn}
                  </span>
                  {p.active ? <Badge tone="green">使用中</Badge> : <Badge>{p.id}</Badge>}
                </div>
                <div className="mt-1 truncate text-sm text-slate-500 dark:text-slate-400">
                  APN：<span className="font-mono text-[13px]">{p.apn}</span>
                </div>
                <div className="mt-2 flex gap-1.5">
                  <Badge tone="blue">{pdpLabel(p.pdpType)}</Badge>
                  <Badge tone="purple">{authLabel(p.authMode)}</Badge>
                </div>
                <div className="mt-3 flex gap-2">
                  {!p.active && (
                    <Button size="sm" loading={actBusy === p.id} onClick={() => activate(p)}>
                      激活
                    </Button>
                  )}
                  <Button size="sm" variant="secondary" icon={<Pencil size={12} />} onClick={() => openEdit(p)}>
                    编辑
                  </Button>
                  {!p.active && (
                    <Button
                      size="sm"
                      variant="danger"
                      icon={<Trash2 size={12} />}
                      onClick={() => setDelTarget(p)}
                    >
                      删除
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `编辑 APN（${editing.id}）` : '新建 APN'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              取消
            </Button>
            <Button loading={saving} onClick={save}>
              保存
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {!editing && autoProfiles.length > 0 && (
            <Field label="从自动识别填充" hint="选择设备根据 SIM 卡自动识别的 APN">
              <Select value="" onChange={(e) => fillFromAuto(e.target.value)}>
                <option value="">选择自动 APN…</option>
                {autoProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name || p.apn}（{p.apn}）
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="名称">
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="例如：CMCC"
            />
          </Field>
          <Field label="APN">
            <Input
              value={form.apn}
              onChange={(e) => setForm({ ...form, apn: e.target.value })}
              placeholder="例如：cmnet"
              className="font-mono"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="PDP 类型">
              <Select
                value={form.pdpType}
                onChange={(e) => setForm({ ...form, pdpType: Number(e.target.value) })}
              >
                <option value={1}>IPv4</option>
                <option value={2}>IPv6</option>
                <option value={3}>IPv4v6</option>
              </Select>
            </Field>
            <Field label="认证方式">
              <Select
                value={form.authMode}
                onChange={(e) => setForm({ ...form, authMode: Number(e.target.value) })}
              >
                <option value={0}>无</option>
                <option value={1}>PAP</option>
                <option value={2}>CHAP</option>
              </Select>
            </Field>
          </div>
          {form.authMode !== 0 && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="用户名">
                <Input
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                />
              </Field>
              <Field label="密码">
                <Input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </Field>
            </div>
          )}
        </div>
      </Modal>

      <ConfirmModal
        open={delTarget != null}
        onClose={() => setDelTarget(null)}
        onConfirm={doDelete}
        loading={delBusy}
        title="删除 APN"
        danger
        confirmText="删除"
        message={`确定删除 APN「${delTarget?.name || delTarget?.apn}」（${delTarget?.apn}）吗？此操作不可恢复。`}
      />
    </div>
  )
}

/* ---------- 页面 ---------- */

export default function Network() {
  const [tab, setTab] = useState('data')
  return (
    <div className="space-y-4">
      <PageHeader title="移动网络" desc="数据连接、网络模式、运营商与 APN 管理" />
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'data', label: '数据连接', icon: <SignalIcon size={14} /> },
          { key: 'mode', label: '网络模式', icon: <NetworkIcon size={14} /> },
          { key: 'operator', label: '运营商选择', icon: <Globe size={14} /> },
          { key: 'apn', label: 'APN 管理', icon: <ListPlus size={14} /> },
        ]}
      />
      {tab === 'data' && <DataConnection />}
      {tab === 'mode' && <NetworkModeSection />}
      {tab === 'operator' && <OperatorSection />}
      {tab === 'apn' && <ApnSection />}
    </div>
  )
}
