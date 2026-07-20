import { useState } from 'react'
import {
  CreditCard,
  Fingerprint,
  Lock,
  Unlock,
  Hash,
  LayoutGrid,
  Copy,
  Send,
  XCircle,
  KeyRound,
  ChevronRight,
} from 'lucide-react'
import { api, fetchAll } from '../lib/api'
import { useAsync } from '../lib/hooks'
import { num } from '../lib/format'
import {
  Card,
  KV,
  Badge,
  Button,
  Field,
  Input,
  Modal,
  Progress,
  Spinner,
  ErrorBox,
  EmptyState,
  PageHeader,
  toast,
} from '../components/ui'

interface UssdResult {
  response: string
  session_active: boolean
}

export default function SimPage() {
  const q = useAsync(() =>
    fetchAll({
      info: () => api.get('/api/sim/info'),
      imei: () => api.get('/api/sim/imei'),
      trials: () => api.get('/api/sim/lock-trials'),
    }),
  )

  const info = q.data?.info
  const imei = String(q.data?.imei?.imei ?? '')
  const trials = num(q.data?.trials?.available_trials)

  const simState = String(info?.sim_states ?? '').toLowerCase()
  const modemState = String(info?.modem_main_state ?? '').toLowerCase()
  const pinLocked = simState === 'wait pin' || modemState === 'modem_waitpin'
  const pukLocked = simState === 'wait puk' || modemState === 'modem_waitpuk'
  const pinEnabled = String(info?.pin_status ?? '') === '1'
  const pinLeft = num(info?.pinnumber)
  const pukLeft = num(info?.puknumber)

  /* ---- PIN 锁开关（需输入当前 PIN） ---- */
  const [pinMode, setPinMode] = useState<null | 'enable' | 'disable'>(null)
  const [pinModeInput, setPinModeInput] = useState('')
  const [pinModeBusy, setPinModeBusy] = useState(false)

  const submitPinMode = async () => {
    if (pinModeInput.length < 4) {
      toast.error('PIN 至少 4 位数字')
      return
    }
    setPinModeBusy(true)
    try {
      await api.post('/api/sim/pin/mode', {
        pin_num_m: pinModeInput,
        pin_mode: pinMode === 'enable' ? 1 : 0,
        pin_encode_flag: '0',
      })
      toast.success(pinMode === 'enable' ? 'PIN 锁已开启' : 'PIN 锁已关闭')
      setPinMode(null)
      setPinModeInput('')
      q.refresh()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setPinModeBusy(false)
    }
  }

  /* ---- 验证 PIN ---- */
  const [verifyPin, setVerifyPin] = useState('')
  const [verifyBusy, setVerifyBusy] = useState(false)
  const submitVerify = async () => {
    if (verifyPin.length < 4) {
      toast.error('PIN 至少 4 位数字')
      return
    }
    setVerifyBusy(true)
    try {
      await api.post('/api/sim/pin/verify', { pin_num: verifyPin, puk_num: '', pin_encode_flag: '0' })
      toast.success('PIN 验证成功')
      setVerifyPin('')
      q.refresh()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setVerifyBusy(false)
    }
  }

  /* ---- 修改 PIN ---- */
  const [oldPin, setOldPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [changeBusy, setChangeBusy] = useState(false)
  const submitChange = async () => {
    if (oldPin.length < 4 || newPin.length < 4) {
      toast.error('PIN 至少 4 位数字')
      return
    }
    if (newPin !== confirmPin) {
      toast.error('两次输入的新 PIN 不一致')
      return
    }
    setChangeBusy(true)
    try {
      await api.post('/api/sim/pin/change', { pin_num: oldPin, new_pin_num: newPin, pin_encode_flag: '0' })
      toast.success('PIN 修改成功')
      setOldPin(''); setNewPin(''); setConfirmPin('')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setChangeBusy(false)
    }
  }

  /* ---- PUK 解锁 ---- */
  const [puk, setPuk] = useState('')
  const [pukNewPin, setPukNewPin] = useState('')
  const [pukBusy, setPukBusy] = useState(false)
  const submitPuk = async () => {
    if (puk.length < 8) {
      toast.error('PUK 至少 8 位数字')
      return
    }
    if (pukNewPin.length < 4) {
      toast.error('新 PIN 至少 4 位数字')
      return
    }
    setPukBusy(true)
    try {
      await api.post('/api/sim/pin/verify', { pin_num: pukNewPin, puk_num: puk, pin_encode_flag: '0' })
      toast.success('PUK 解锁成功，新 PIN 已生效')
      setPuk(''); setPukNewPin('')
      q.refresh()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setPukBusy(false)
    }
  }

  /* ---- USSD ---- */
  const [ussdCode, setUssdCode] = useState('')
  const [ussdResp, setUssdResp] = useState<UssdResult | null>(null)
  const [ussdReply, setUssdReply] = useState('')
  const [ussdBusy, setUssdBusy] = useState(false)

  const ussdCall = async (path: string, body: unknown) => {
    setUssdBusy(true)
    try {
      const r = await api.post(path, body)
      setUssdResp({ response: String(r?.response ?? '（无响应内容）'), session_active: r?.session_active === true })
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setUssdBusy(false)
    }
  }

  const cancelUssd = async () => {
    setUssdBusy(true)
    try {
      await api.post('/api/ussd/cancel')
      setUssdResp(null)
      setUssdReply('')
      toast.success('USSD 会话已取消')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setUssdBusy(false)
    }
  }

  /* ---- STK ---- */
  const stk = useAsync(() => api.get('/api/stk/menu'), [])
  const [stkItems, setStkItems] = useState<{ id: number; label: string }[] | null>(null)
  const [stkTitle, setStkTitle] = useState<string | null>(null)
  const [stkDisplay, setStkDisplay] = useState<string | null>(null)
  const [stkBusy, setStkBusy] = useState<number | null>(null)

  const stkSelect = async (id: number) => {
    setStkBusy(id)
    try {
      const r = await api.post('/api/stk/select', { item_id: id })
      if (r?.supported === false) {
        toast.error(r?.reason || 'SIM 卡不支持 STK')
      } else if (r?.type === 'menu') {
        setStkItems(r.items ?? [])
        setStkTitle(r.title ?? null)
        setStkDisplay(null)
      } else if (r?.type === 'display') {
        setStkDisplay(String(r.data ?? ''))
      } else {
        toast.info('操作已提交')
      }
    } catch (e: any) {
      // STK 在部分 SIM/固件上不可用，优雅降级
      toast.error(e.message)
    } finally {
      setStkBusy(null)
    }
  }

  const stkList: { id: number; label: string }[] = stkItems ?? stk.data?.items ?? []
  const stkSupported = stk.data?.supported !== false

  const copyImei = async () => {
    try {
      await navigator.clipboard.writeText(imei)
      toast.success('IMEI 已复制')
    } catch {
      toast.error('复制失败')
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="SIM 卡" desc="SIM 信息 · PIN 管理 · PUK 解锁 · USSD · STK" />

      {q.loading && !q.data ? (
        <Card>
          <Spinner />
        </Card>
      ) : q.error && !q.data ? (
        <Card>
          <ErrorBox error={q.error} onRetry={q.refresh} />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            {/* SIM 信息 */}
            <Card title="SIM 信息" icon={<CreditCard size={15} />}>
              <dl className="divide-y divide-slate-100 dark:divide-white/5">
                <KV k="运营商" v={info?.Operator || '--'} />
                <KV
                  k="SIM 状态"
                  v={
                    pukLocked ? (
                      <Badge tone="red">等待 PUK</Badge>
                    ) : pinLocked ? (
                      <Badge tone="yellow">等待 PIN</Badge>
                    ) : (
                      <Badge tone="green">{info?.sim_states || '正常'}</Badge>
                    )
                  }
                />
                <KV k="IMSI" v={info?.sim_imsi} mono />
                <KV k="ICCID" v={info?.sim_iccid} mono />
                <KV k="本机号码" v={info?.msisdn} mono />
                <KV k="MCC / MNC" v={`${info?.mdm_mcc ?? '--'} / ${info?.mdm_mnc ?? '--'}`} />
                <KV k="当前卡槽" v={info?.current_sim_slot} />
                <KV
                  k="PIN 锁"
                  v={pinEnabled ? <Badge tone="green">已开启</Badge> : <Badge tone="slate">已关闭</Badge>}
                />
              </dl>
            </Card>

            {/* IMEI + 剩余次数 */}
            <Card title="标识与尝试次数" icon={<Fingerprint size={15} />}>
              <div className="space-y-4">
                <div>
                  <div className="mb-1 text-xs text-slate-500 dark:text-slate-400">IMEI</div>
                  <div className="flex items-center gap-2">
                    <span className="tabular min-w-0 flex-1 truncate rounded-lg bg-slate-100 px-3 py-2 font-mono text-sm dark:bg-white/5">
                      {imei || '--'}
                    </span>
                    <Button size="sm" variant="secondary" icon={<Copy size={13} />} disabled={!imei} onClick={copyImei}>
                      复制
                    </Button>
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500 dark:text-slate-400">PIN 剩余尝试次数</span>
                    <span className="tabular font-medium">{pinLeft != null ? `${pinLeft} / 3` : '--'}</span>
                  </div>
                  <Progress value={pinLeft != null ? (pinLeft / 3) * 100 : 0} tone="auto" />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500 dark:text-slate-400">PUK 剩余尝试次数</span>
                    <span className="tabular font-medium">{pukLeft != null ? `${pukLeft} / 10` : '--'}</span>
                  </div>
                  <Progress value={pukLeft != null ? (pukLeft / 10) * 100 : 0} tone="auto" />
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 dark:text-slate-400">网络锁解锁剩余次数</span>
                  {trials != null ? <Badge tone="brand">{trials} 次</Badge> : <span>--</span>}
                </div>
              </div>
            </Card>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            {/* PIN 管理 */}
            <Card title="PIN 管理" icon={<Lock size={15} />}>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-slate-700 dark:text-slate-200">PIN 锁</div>
                    <div className="text-xs text-slate-400">开机时需输入 PIN 才能使用 SIM</div>
                  </div>
                  <Button
                    size="sm"
                    variant={pinEnabled ? 'secondary' : 'primary'}
                    onClick={() => setPinMode(pinEnabled ? 'disable' : 'enable')}
                  >
                    {pinEnabled ? '关闭 PIN 锁' : '开启 PIN 锁'}
                  </Button>
                </div>

                <div className="border-t border-slate-100 pt-3 dark:border-white/5">
                  <Field label="验证 PIN" hint={pinLocked ? 'SIM 当前处于锁定状态，请输入 PIN 解锁' : 'SIM 锁定后需验证 PIN 才能使用'}>
                    <div className="flex gap-2">
                      <Input
                        type="password"
                        inputMode="numeric"
                        maxLength={8}
                        value={verifyPin}
                        onChange={(e) => setVerifyPin(e.target.value.replace(/\D/g, ''))}
                        placeholder="输入 PIN"
                      />
                      <Button size="sm" loading={verifyBusy} onClick={submitVerify}>
                        验证
                      </Button>
                    </div>
                  </Field>
                </div>

                <div className="space-y-2 border-t border-slate-100 pt-3 dark:border-white/5">
                  <div className="text-xs font-medium text-slate-500 dark:text-slate-400">修改 PIN</div>
                  <Input
                    type="password"
                    inputMode="numeric"
                    maxLength={8}
                    value={oldPin}
                    onChange={(e) => setOldPin(e.target.value.replace(/\D/g, ''))}
                    placeholder="当前 PIN"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      type="password"
                      inputMode="numeric"
                      maxLength={8}
                      value={newPin}
                      onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                      placeholder="新 PIN"
                    />
                    <Input
                      type="password"
                      inputMode="numeric"
                      maxLength={8}
                      value={confirmPin}
                      onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                      placeholder="确认新 PIN"
                    />
                  </div>
                  <div className="flex justify-end">
                    <Button size="sm" variant="secondary" icon={<KeyRound size={13} />} loading={changeBusy} onClick={submitChange}>
                      修改 PIN
                    </Button>
                  </div>
                </div>
              </div>
            </Card>

            {/* PUK 解锁 */}
            <Card title="PUK 解锁" icon={<Unlock size={15} />}>
              <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                当 PIN 连续输错导致 SIM 锁定时，使用运营商提供的 PUK 码解锁并设置新 PIN。
                PUK 连续输错 10 次将导致 SIM 卡永久报废，请谨慎操作。
              </div>
              <div className="space-y-2">
                <Field label="PUK 码">
                  <Input
                    type="password"
                    inputMode="numeric"
                    maxLength={8}
                    value={puk}
                    onChange={(e) => setPuk(e.target.value.replace(/\D/g, ''))}
                    placeholder="8 位 PUK 码"
                  />
                </Field>
                <Field label="新 PIN">
                  <Input
                    type="password"
                    inputMode="numeric"
                    maxLength={8}
                    value={pukNewPin}
                    onChange={(e) => setPukNewPin(e.target.value.replace(/\D/g, ''))}
                    placeholder="4-8 位新 PIN"
                  />
                </Field>
                <div className="flex justify-end">
                  <Button size="sm" variant="danger" icon={<Unlock size={13} />} loading={pukBusy} onClick={submitPuk}>
                    PUK 解锁
                  </Button>
                </div>
              </div>
            </Card>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            {/* USSD */}
            <Card title="USSD 查询" icon={<Hash size={15} />}>
              <div className="space-y-3">
                <div className="flex gap-2">
                  <Input
                    value={ussdCode}
                    onChange={(e) => setUssdCode(e.target.value)}
                    placeholder="如 *123#"
                    className="font-mono"
                    onKeyDown={(e) => e.key === 'Enter' && ussdCode && ussdCall('/api/ussd/send', { code: ussdCode })}
                  />
                  <Button
                    size="sm"
                    icon={<Send size={13} />}
                    loading={ussdBusy}
                    disabled={!ussdCode}
                    onClick={() => ussdCall('/api/ussd/send', { code: ussdCode })}
                  >
                    发送
                  </Button>
                </div>

                {ussdResp && (
                  <div className="rounded-xl bg-slate-50 p-3 dark:bg-white/5">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-xs text-slate-400">响应</span>
                      {ussdResp.session_active ? (
                        <Badge tone="yellow">会话进行中</Badge>
                      ) : (
                        <Badge tone="slate">会话已结束</Badge>
                      )}
                    </div>
                    <pre className="whitespace-pre-wrap break-all font-mono text-xs text-slate-700 dark:text-slate-200">
                      {ussdResp.response}
                    </pre>
                  </div>
                )}

                {ussdResp?.session_active && (
                  <div className="flex gap-2">
                    <Input
                      value={ussdReply}
                      onChange={(e) => setUssdReply(e.target.value)}
                      placeholder="输入菜单序号回复"
                      className="font-mono"
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={ussdBusy}
                      disabled={!ussdReply}
                      onClick={() => ussdCall('/api/ussd/respond', { reply: ussdReply }).then(() => setUssdReply(''))}
                    >
                      回复
                    </Button>
                    <Button size="sm" variant="ghost" icon={<XCircle size={13} />} loading={ussdBusy} onClick={cancelUssd}>
                      取消会话
                    </Button>
                  </div>
                )}
              </div>
            </Card>

            {/* STK */}
            <Card
              title="STK (SIM 应用)"
              icon={<LayoutGrid size={15} />}
              extra={stkTitle || stk.data?.title ? <Badge tone="brand">{stkTitle ?? stk.data?.title}</Badge> : undefined}
            >
              {stk.loading && !stk.data ? (
                <Spinner />
              ) : stk.error && !stk.data ? (
                <ErrorBox error={stk.error} onRetry={stk.refresh} />
              ) : !stkSupported ? (
                <EmptyState text="当前 SIM 卡不支持 STK 应用" />
              ) : stkList.length === 0 ? (
                <EmptyState text={stk.data?.reason === 'no proactive command pending' ? '当前无可用 STK 菜单' : '暂无 STK 菜单'} />
              ) : (
                <div className="space-y-2">
                  {stkDisplay && (
                    <div className="rounded-xl bg-slate-50 p-3 dark:bg-white/5">
                      <pre className="whitespace-pre-wrap break-all font-mono text-xs text-slate-700 dark:text-slate-200">
                        {stkDisplay}
                      </pre>
                    </div>
                  )}
                  <div className="divide-y divide-slate-100 dark:divide-white/5">
                    {stkList.map((it) => (
                      <button
                        key={it.id}
                        type="button"
                        disabled={stkBusy !== null}
                        onClick={() => stkSelect(it.id)}
                        className="flex w-full items-center justify-between gap-2 py-2.5 text-left text-sm text-slate-700 transition-colors hover:text-brand-600 disabled:opacity-50 dark:text-slate-200 dark:hover:text-brand-400"
                      >
                        <span className="min-w-0 truncate">{it.label}</span>
                        <ChevronRight size={14} className="shrink-0 text-slate-400" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          </div>
        </>
      )}

      {/* PIN 锁开关 Modal */}
      <Modal
        open={pinMode !== null}
        onClose={() => setPinMode(null)}
        title={pinMode === 'enable' ? '开启 PIN 锁' : '关闭 PIN 锁'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPinMode(null)}>
              取消
            </Button>
            <Button variant={pinMode === 'disable' ? 'danger' : 'primary'} loading={pinModeBusy} onClick={submitPinMode}>
              确认
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {pinMode === 'enable'
              ? '开启后，每次设备开机都需要输入 PIN 才能使用 SIM 卡。请输入当前 PIN 确认。'
              : '关闭后将不再要求输入 PIN。请输入当前 PIN 确认。'}
          </p>
          <Input
            type="password"
            inputMode="numeric"
            maxLength={8}
            autoFocus
            value={pinModeInput}
            onChange={(e) => setPinModeInput(e.target.value.replace(/\D/g, ''))}
            placeholder="当前 PIN"
          />
        </div>
      </Modal>
    </div>
  )
}
