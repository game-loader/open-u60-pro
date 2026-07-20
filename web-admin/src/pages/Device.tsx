import { useEffect, useState } from 'react'
import {
  Cpu,
  Power,
  BatteryCharging,
  Usb,
  RotateCcw,
  Eraser,
  Zap,
  Rocket,
  AlertTriangle,
} from 'lucide-react'
import { api } from '../lib/api'
import { useAsync } from '../lib/hooks'
import { fmtBytes, fmtUptime, num, num0 } from '../lib/format'
import {
  Card,
  KV,
  Badge,
  Button,
  Field,
  Input,
  Select,
  Toggle,
  Modal,
  ConfirmModal,
  Progress,
  Stat,
  Spinner,
  ErrorBox,
  PageHeader,
  toast,
} from '../components/ui'

const USB_MODES = [
  { value: 'charge', label: '仅充电' },
  { value: 'rndis', label: '网络共享 (RNDIS)' },
  { value: 'debug', label: '调试 (ADB)' },
] as const

export default function DevicePage() {
  const system = useAsync(() => api.get('/api/device/system'), [])
  const device = useAsync(() => api.get('/api/device'), [])
  const charge = useAsync(() => api.get('/api/device/charge-control'), [])
  const fastboot = useAsync(() => api.get('/api/device/fast-boot'), [])
  const powersave = useAsync(() => api.post('/api/device/power-save', { deviceInfoList: ['power_saver_mode'] }), [])
  const charger = useAsync(() => api.get('/api/device/charger'), [])
  const usb = useAsync(() => api.get('/api/usb/status'), [])

  /* ---- 重启 / 恢复出厂 ---- */
  const [rebootOpen, setRebootOpen] = useState(false)
  const [rebootBusy, setRebootBusy] = useState(false)
  const doReboot = async () => {
    setRebootBusy(true)
    try {
      await api.post('/api/device/reboot')
      toast.success('设备正在重启，请稍后重新连接')
      setRebootOpen(false)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setRebootBusy(false)
    }
  }

  const [resetOpen, setResetOpen] = useState(false)
  const [resetText, setResetText] = useState('')
  const [resetBusy, setResetBusy] = useState(false)
  const doFactoryReset = async () => {
    if (resetText !== 'RESET') return
    setResetBusy(true)
    try {
      await api.post('/api/device/factory-reset')
      toast.success('已发起恢复出厂设置，设备将重启')
      setResetOpen(false)
      setResetText('')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setResetBusy(false)
    }
  }

  /* ---- 省电模式 / 快速启动 ---- */
  const [psBusy, setPsBusy] = useState(false)
  const psOn = String(powersave.data?.power_saver_mode ?? '') === '1'
  const togglePowerSave = async (v: boolean) => {
    setPsBusy(true)
    try {
      await api.put('/api/device/power-save', { deviceInfoList: { power_saver_mode: v ? '1' : '0' } })
      if (powersave.data) powersave.setData({ ...powersave.data, power_saver_mode: v ? '1' : '0' })
      toast.success(v ? '省电模式已开启' : '省电模式已关闭')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setPsBusy(false)
    }
  }

  const [fbBusy, setFbBusy] = useState(false)
  const fbOn = String(fastboot.data?.fast_boot ?? '') === '1'
  const toggleFastBoot = async (v: boolean) => {
    setFbBusy(true)
    try {
      const r = await api.put('/api/device/fast-boot', { fast_boot: v ? '1' : '0' })
      fastboot.setData(r)
      toast.success(v ? '快速启动已开启' : '快速启动已关闭')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setFbBusy(false)
    }
  }

  /* ---- 充电管理 ---- */
  const [stopBusy, setStopBusy] = useState(false)
  const toggleStop = async (v: boolean) => {
    setStopBusy(true)
    try {
      const r = await api.put('/api/device/charge-control', { charging_stopped: v })
      charge.setData(r)
      toast.success(v ? '已停止充电（直供电模式）' : '已恢复充电')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setStopBusy(false)
    }
  }

  const [clEnabled, setClEnabled] = useState(false)
  const [clLimit, setClLimit] = useState('80')
  const [clHyst, setClHyst] = useState('5')
  const [clBusy, setClBusy] = useState(false)

  useEffect(() => {
    const c = charge.data
    if (c) {
      setClEnabled(c.charge_limit_enabled === true)
      setClLimit(String(c.charge_limit ?? 80))
      setClHyst(String(c.hysteresis ?? 5))
    }
  }, [charge.data])

  const saveChargeLimit = async () => {
    setClBusy(true)
    try {
      const r = await api.put('/api/device/charge-control', {
        charge_limit_enabled: clEnabled,
        charge_limit: num0(clLimit),
        hysteresis: num0(clHyst),
      })
      charge.setData(r)
      toast.success(clEnabled ? `充电限制已设置为 ${clLimit}%` : '充电限制已关闭')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setClBusy(false)
    }
  }

  /* ---- USB ---- */
  const [usbMode, setUsbMode] = useState('')
  const [usbBusy, setUsbBusy] = useState(false)
  const [adbOpen, setAdbOpen] = useState(false)

  useEffect(() => {
    if (usb.data?.mode) setUsbMode(String(usb.data.mode))
  }, [usb.data])

  const switchUsbMode = async (mode: string) => {
    setUsbBusy(true)
    try {
      await api.put('/api/usb/mode', { mode })
      toast.success(`USB 模式已切换为 ${USB_MODES.find((m) => m.value === mode)?.label ?? mode}`)
      usb.refresh()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setUsbBusy(false)
      setAdbOpen(false)
    }
  }

  const applyUsbMode = () => {
    if (!usbMode || usbMode === String(usb.data?.mode ?? '')) return
    if (usbMode === 'debug') {
      setAdbOpen(true)
    } else {
      switchUsbMode(usbMode)
    }
  }

  const [pbBusy, setPbBusy] = useState(false)
  const [pbOpen, setPbOpen] = useState(false)
  const pbOn = num(charger.data?.otg_powerbank_state) === 1
  const setPowerbank = async (v: boolean) => {
    setPbBusy(true)
    try {
      await api.put('/api/usb/powerbank', { state: v ? 1 : 0 })
      if (charger.data) charger.setData({ ...charger.data, otg_powerbank_state: v ? 1 : 0 })
      toast.success(v ? '充电宝模式已开启，设备正对外供电' : '充电宝模式已关闭')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setPbBusy(false)
      setPbOpen(false)
    }
  }
  const togglePowerbank = (v: boolean) => {
    if (v) setPbOpen(true)
    else setPowerbank(false)
  }

  /* ---- 系统信息派生 ---- */
  const sys = system.data
  const release = sys?.release
  const firmware = release?.description || [release?.distribution, release?.version].filter(Boolean).join(' ') || '--'
  const memTotal = num0(sys?.total) * 1024
  const memFree = num0(sys?.free) * 1024
  const capacity = num(charge.data?.capacity)

  return (
    <div className="space-y-4">
      <PageHeader title="设备管理" desc="系统信息 · 电源 · 充电管理 · USB" />

      {/* 系统信息 */}
      <Card title="系统信息" icon={<Cpu size={15} />}>
        {system.loading && !system.data ? (
          <Spinner />
        ) : system.error && !system.data ? (
          <ErrorBox error={system.error} onRetry={system.refresh} />
        ) : (
          <dl className="divide-y divide-slate-100 dark:divide-white/5">
            <KV k="型号" v={sys?.model || sys?.board_name} />
            <KV k="固件" v={firmware} />
            <KV k="内核" v={sys?.kernel} mono />
            <KV k="主机名" v={sys?.hostname || device.data?.hostname} />
            <KV k="运行时间" v={fmtUptime(num(sys?.uptime ?? device.data?.uptime_secs))} />
            <KV
              k="负载 (1/5/15)"
              v={
                device.data?.load_avg
                  ? (device.data.load_avg as number[]).map((l) => l.toFixed(2)).join('  ')
                  : '--'
              }
            />
            <KV
              k="内存 (已用 / 总量)"
              v={memTotal > 0 ? `${fmtBytes(memTotal - memFree)} / ${fmtBytes(memTotal)}` : '--'}
            />
          </dl>
        )}
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* 电源 */}
        <Card title="电源" icon={<Power size={15} />}>
          <div className="divide-y divide-slate-100 dark:divide-white/5">
            <div className="flex items-center justify-between gap-3 py-2.5">
              <div>
                <div className="text-sm text-slate-700 dark:text-slate-200">重启设备</div>
                <div className="text-xs text-slate-400">重启期间网络将中断约 1 分钟</div>
              </div>
              <Button size="sm" variant="danger" icon={<RotateCcw size={13} />} onClick={() => setRebootOpen(true)}>
                重启
              </Button>
            </div>
            <div className="flex items-center justify-between gap-3 py-2.5">
              <div>
                <div className="text-sm text-slate-700 dark:text-slate-200">恢复出厂设置</div>
                <div className="text-xs text-slate-400">清除所有配置，恢复为出厂状态</div>
              </div>
              <Button size="sm" variant="danger" icon={<Eraser size={13} />} onClick={() => setResetOpen(true)}>
                恢复出厂
              </Button>
            </div>
            <div className="flex items-center justify-between gap-3 py-2.5">
              <div>
                <div className="flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-200">
                  <Zap size={13} className="text-brand-500" />
                  省电模式
                </div>
                <div className="text-xs text-slate-400">降低功耗，可能影响性能与信号</div>
              </div>
              <Toggle checked={psOn} loading={psBusy} disabled={!powersave.data} onChange={togglePowerSave} />
            </div>
            <div className="flex items-center justify-between gap-3 py-2.5">
              <div>
                <div className="flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-200">
                  <Rocket size={13} className="text-brand-500" />
                  快速启动
                </div>
                <div className="text-xs text-slate-400">加快开机速度</div>
              </div>
              <Toggle checked={fbOn} loading={fbBusy} disabled={!fastboot.data} onChange={toggleFastBoot} />
            </div>
          </div>
        </Card>

        {/* 充电管理 */}
        <Card title="充电管理" icon={<BatteryCharging size={15} />}>
          {charge.loading && !charge.data ? (
            <Spinner />
          ) : charge.error && !charge.data ? (
            <ErrorBox error={charge.error} onRetry={charge.refresh} />
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Stat label="当前电量" value={capacity != null ? `${capacity}%` : '--'} />
                <Stat label="电池状态" value={charge.data?.battery_status || '--'} />
              </div>
              <Progress value={capacity ?? 0} tone="auto" />

              <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-3 dark:border-white/5">
                <div>
                  <div className="text-sm text-slate-700 dark:text-slate-200">停止充电（直供电）</div>
                  <div className="text-xs text-slate-400">开启后由电源直接供电，不经过电池</div>
                </div>
                <Toggle checked={charge.data?.charging_stopped === true} loading={stopBusy} onChange={toggleStop} />
              </div>

              <div className="space-y-2 border-t border-slate-100 pt-3 dark:border-white/5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm text-slate-700 dark:text-slate-200">充电限制</div>
                    <div className="text-xs text-slate-400">充到阈值后停止，回落回差后继续</div>
                  </div>
                  <Toggle checked={clEnabled} onChange={setClEnabled} />
                </div>
                {clEnabled && (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="充电上限 (%)">
                      <Select value={clLimit} onChange={(e) => setClLimit(e.target.value)}>
                        {[60, 65, 70, 75, 80, 85, 90, 95, 100].map((v) => (
                          <option key={v} value={String(v)}>
                            {v}%
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="回差 (%)" hint="电量低于 上限-回差 时恢复充电">
                      <Input value={clHyst} onChange={(e) => setClHyst(e.target.value)} inputMode="numeric" />
                    </Field>
                  </div>
                )}
                <div className="flex justify-end">
                  <Button size="sm" variant="secondary" loading={clBusy} onClick={saveChargeLimit}>
                    保存充电设置
                  </Button>
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* USB */}
      <Card title="USB" icon={<Usb size={15} />}>
        {usb.loading && !usb.data ? (
          <Spinner />
        ) : usb.error && !usb.data ? (
          <ErrorBox error={usb.error} onRetry={usb.refresh} />
        ) : (
          <div className="space-y-3">
            <dl className="divide-y divide-slate-100 dark:divide-white/5">
              <KV
                k="当前模式"
                v={
                  <Badge tone="brand">
                    {USB_MODES.find((m) => m.value === String(usb.data?.mode ?? ''))?.label ??
                      (usb.data?.mode || '--')}
                  </Badge>
                }
              />
              <KV
                k="USB 线缆"
                v={
                  String(usb.data?.typec_cc ?? 'no_cc') !== 'no_cc' ? (
                    <Badge tone="green">已连接</Badge>
                  ) : (
                    <Badge tone="slate">未连接</Badge>
                  )
                }
              />
              <KV
                k="数据连接"
                v={num(usb.data?.connect) === 1 ? <Badge tone="green">已建立</Badge> : <Badge tone="slate">未建立</Badge>}
              />
            </dl>

            <div className="flex items-end gap-2 border-t border-slate-100 pt-3 dark:border-white/5">
              <div className="flex-1">
                <Field label="USB 模式" hint="选择「调试 (ADB)」将开启 ADB 调试接口">
                  <Select value={usbMode} onChange={(e) => setUsbMode(e.target.value)}>
                    {USB_MODES.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Button
                size="sm"
                loading={usbBusy}
                disabled={!usbMode || usbMode === String(usb.data?.mode ?? '')}
                onClick={applyUsbMode}
              >
                切换
              </Button>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-3 dark:border-white/5">
              <div>
                <div className="text-sm text-slate-700 dark:text-slate-200">充电宝模式</div>
                <div className="text-xs text-slate-400">通过 USB 为其他设备供电（消耗本机电量）</div>
              </div>
              <Toggle checked={pbOn} loading={pbBusy} disabled={!charger.data} onChange={togglePowerbank} />
            </div>
          </div>
        )}
      </Card>

      {/* 重启确认 */}
      <ConfirmModal
        open={rebootOpen}
        onClose={() => setRebootOpen(false)}
        onConfirm={doReboot}
        title="重启设备"
        message="重启期间所有网络连接将中断，约 1 分钟后恢复。确定要重启设备吗？"
        danger
        loading={rebootBusy}
        confirmText="重启"
      />

      {/* 恢复出厂确认（输入 RESET） */}
      <Modal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="恢复出厂设置"
        footer={
          <>
            <Button variant="secondary" onClick={() => setResetOpen(false)}>
              取消
            </Button>
            <Button variant="danger" loading={resetBusy} disabled={resetText !== 'RESET'} onClick={doFactoryReset}>
              恢复出厂
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="flex items-start gap-3 text-sm text-slate-600 dark:text-slate-300">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-500" />
            <p>
              此操作将清除设备上的所有配置（WiFi、APN、管理密码等）并恢复为出厂状态，且不可撤销。
              请输入 <span className="font-mono font-bold text-red-500">RESET</span> 确认操作。
            </p>
          </div>
          <Input
            value={resetText}
            onChange={(e) => setResetText(e.target.value)}
            placeholder="输入 RESET 确认"
            className="font-mono"
            autoFocus
          />
        </div>
      </Modal>

      {/* ADB 确认 */}
      <ConfirmModal
        open={adbOpen}
        onClose={() => setAdbOpen(false)}
        onConfirm={() => switchUsbMode('debug')}
        title="开启 ADB 调试"
        message="切换到调试模式将开启 ADB 调试接口，USB 网络共享会断开。请确认你了解该操作的影响。"
        loading={usbBusy}
        confirmText="开启 ADB"
      />

      {/* 充电宝确认 */}
      <ConfirmModal
        open={pbOpen}
        onClose={() => setPbOpen(false)}
        onConfirm={() => setPowerbank(true)}
        title="开启充电宝模式"
        message="开启后设备将通过 USB 接口对外供电，会加快本机电池消耗。确定开启吗？"
        loading={pbBusy}
        confirmText="开启"
      />
    </div>
  )
}
