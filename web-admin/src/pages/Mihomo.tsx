import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Download,
  FileCode2,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Shield,
  Square,
  Terminal,
  Trash2,
  Upload,
  Waypoints,
  Zap,
} from 'lucide-react'
import { api, requestRaw, uploadBinary } from '../lib/api'
import { usePoll, usePolledData } from '../lib/hooks'
import { fmtBytes, fmtTime, fmtUptime } from '../lib/format'
import {
  Badge,
  Button,
  Card,
  ConfirmModal,
  ErrorBox,
  Field,
  Input,
  KV,
  PageHeader,
  Progress,
  Select,
  Spinner,
  Stat,
  Toggle,
  toast,
} from '../components/ui'

type StatusData = {
  installed: boolean
  version: string | null
  running: boolean
  pid: number | null
  uptime_secs: number
  desired_running: boolean
  autostart: boolean
  transparent: boolean
  requested_mode: string
  effective_mode: string | null
  safe_mode: boolean
  binary_size: number | null
  binary_sha256: string | null
  config: { path: string; runtime_path: string; valid: boolean; modified_at: number | null }
  network: {
    lan_interfaces: string[]
    dns_override: boolean
    quic_blocked: boolean
    ipv6_blocked: boolean
  }
  effective: { mixed_port: number; redir_port: number; dns_port: number } | null
  controller: { address: string; reachable: boolean }
  memory_kb: number | null
  last_error: string | null
}

type SettingsData = {
  autostart: boolean
  desired_running: boolean
  transparent: boolean
  transparent_mode: string
  block_quic: boolean
  block_ipv6: boolean
  controller_port: number
  mixed_port: number
  redir_port: number
  dns_port: number
  lan_interfaces: string[]
  safe_mode: boolean
  last_error: string | null
  installed_version: string | null
}

type Capabilities = {
  root: boolean
  tun: { available: boolean; detail: string }
  iptables: { available: boolean; detail: string }
  ip6tables: { available: boolean; detail: string }
  nftables: { available: boolean; detail: string }
  dnsmasq: { available: boolean; detail: string }
  lan_interfaces: string[]
}

type ProxyGroup = {
  name: string
  type: string
  now: string | null
  all: string[]
  selectable: boolean
}

type ProxyData = {
  groups: ProxyGroup[]
  count: number
}

const DEFAULT_VERSION = 'v1.19.32'
const DEFAULT_SHA = '9dd862e28b46ff7d775f169cceebc28deccaa0a9e804237d421cd2571e0caba0'

export default function MihomoPage() {
  const statusPoll = usePolledData<StatusData>(() => api.get('/api/mihomo/status'), 5000)
  const capsPoll = usePolledData<Capabilities>(() => api.get('/api/mihomo/capabilities'), 30000)
  const proxiesPoll = usePolledData<ProxyData>(
    () => api.get('/api/mihomo/proxies'),
    10000,
    !!statusPoll.data?.running,
  )
  const status = statusPoll.data
  const caps = capsPoll.data
  const proxyData = proxiesPoll.data

  const [settings, setSettings] = useState<SettingsData | null>(null)
  const [configText, setConfigText] = useState('')
  const [configMeta, setConfigMeta] = useState<any>(null)
  const [configLoaded, setConfigLoaded] = useState(false)
  const [logs, setLogs] = useState('')
  const [busy, setBusy] = useState('')
  const [configBusy, setConfigBusy] = useState('')
  const [logsBusy, setLogsBusy] = useState(false)
  const [capsBusy, setCapsBusy] = useState(false)
  const [proxyBusy, setProxyBusy] = useState('')
  const [confirmTransparent, setConfirmTransparent] = useState(false)
  const [confirmPanic, setConfirmPanic] = useState(false)
  const [installFile, setInstallFile] = useState<File | null>(null)
  const [installVersion, setInstallVersion] = useState(DEFAULT_VERSION)
  const [installSha, setInstallSha] = useState(DEFAULT_SHA)
  const [uploadPct, setUploadPct] = useState<number | null>(null)

  const refreshSettings = async () => {
    try {
      const data = await api.get<SettingsData>('/api/mihomo/settings')
      setSettings(data)
    } catch {
      /* status card shows the primary error */
    }
  }

  const refreshConfig = async () => {
    try {
      const data = await api.get<any>('/api/mihomo/config')
      setConfigText(data.yaml ?? '')
      setConfigMeta(data)
      setConfigLoaded(true)
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const refreshCaps = async () => {
    setCapsBusy(true)
    try {
      const data = await api.get<Capabilities>('/api/mihomo/capabilities?force=1')
      capsPoll.setData(data)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setCapsBusy(false)
    }
  }

  const refreshLogs = async () => {
    try {
      const data = await api.get<any>('/api/mihomo/logs?lines=200')
      setLogs(data.lines ?? '')
    } catch {
      /* logs are non-critical */
    }
  }

  useEffect(() => {
    void refreshSettings()
    void refreshConfig()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  usePoll(refreshLogs, 5000, true)

  const run = async (name: string, fn: () => Promise<unknown>, success: string) => {
    setBusy(name)
    try {
      await fn()
      toast.success(success)
      await statusPoll.refresh()
      await refreshSettings()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy('')
    }
  }

  const start = () => run('start', () => api.post('/api/mihomo/start'), 'mihomo 已启动')
  const stop = () => run('stop', () => api.post('/api/mihomo/stop'), 'mihomo 已停止，网络已恢复')
  const restart = () => run('restart', () => api.post('/api/mihomo/restart'), 'mihomo 已重启')

  const updateSettings = async (patch: Record<string, unknown>, message: string) => {
    try {
      const data = await api.put<any>('/api/mihomo/settings', patch)
      setSettings(data.settings)
      await statusPoll.refresh()
      toast.success(message)
      if (data.needs_restart) toast.info('设置已保存；需要重启 mihomo 才会生效')
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const toggleAutostart = (v: boolean) =>
    updateSettings({ autostart: v }, v ? '已开启开机自启' : '已关闭开机自启')

  const applyTransparent = async () => {
    setConfirmTransparent(false)
    await updateSettings(
      { transparent: true, transparent_mode: settings?.transparent_mode ?? 'auto' },
      '透明代理已启用；需要重启 mihomo 生效',
    )
  }

  const toggleTransparent = (v: boolean) => {
    if (v) {
      setConfirmTransparent(true)
    } else {
      void updateSettings({ transparent: false }, '透明代理已关闭；需要重启 mihomo 恢复网络')
    }
  }

  const setMode = (mode: string) =>
    updateSettings({ transparent_mode: mode }, `已切换为 ${mode} 模式`)

  const selectProxy = async (group: string, name: string) => {
    if (!name) return
    setProxyBusy(group)
    try {
      await api.put('/api/mihomo/proxies', { group, name })
      toast.success(`已切换到 ${name}`)
      await proxiesPoll.refresh()
    } catch (e: any) {
      toast.error(e.message)
      await proxiesPoll.refresh()
    } finally {
      setProxyBusy('')
    }
  }

  const clearSafeMode = () =>
    run('safe', async () => {
      await api.post('/api/mihomo/safe-mode/clear')
      await refreshConfig()
    }, '安全模式已清除')

  const panic = () =>
    run('panic', async () => {
      await api.post('/api/mihomo/panic')
      setConfirmPanic(false)
    }, '已停止 mihomo 并恢复网络，开机自启已关闭')

  const validateConfig = async () => {
    setConfigBusy('validate')
    try {
      const result = await requestRaw<any>('POST', '/api/mihomo/config/validate', configText, 'text/yaml')
      toast.success(`配置有效（${result.mode ?? '当前模式'}）`)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setConfigBusy('')
    }
  }

  const saveConfig = async (restartAfter: boolean) => {
    setConfigBusy(restartAfter ? 'save-restart' : 'save')
    try {
      const result = await requestRaw<any>('PUT', '/api/mihomo/config', configText, 'text/yaml')
      if (restartAfter && status?.running) {
        await api.post('/api/mihomo/restart')
        toast.success('配置已保存并重启 mihomo')
      } else {
        toast.success(result.needs_restart ? '配置已保存；重启 mihomo 后生效' : '配置已保存')
      }
      await statusPoll.refresh()
      await refreshConfig()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setConfigBusy('')
    }
  }

  const onConfigFile = async (file: File | null) => {
    if (!file) return
    try {
      setConfigText(await file.text())
      toast.info(`已载入 ${file.name}，尚未保存`)
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const downloadConfig = () => {
    const blob = new Blob([configText], { type: 'text/yaml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'config.yaml'
    a.click()
    URL.revokeObjectURL(url)
  }

  const uploadInstall = async () => {
    if (!installFile) {
      toast.error('请先选择 mihomo 二进制（ELF 或 .gz）')
      return
    }
    setBusy('install-upload')
    setUploadPct(0)
    try {
      const result = await uploadBinary<any>('/api/mihomo/install/upload', installFile, setUploadPct)
      toast.success(`已安装 ${result.version ?? 'mihomo'}；重启 mihomo 后生效`)
      setInstallFile(null)
      await statusPoll.refresh()
      await refreshSettings()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy('')
      setUploadPct(null)
    }
  }

  const downloadInstall = () =>
    run('install-download', async () => {
      await api.post<any>('/api/mihomo/install/download', {
        version: installVersion.trim(),
        sha256: installSha.trim(),
      })
    }, 'mihomo 已下载并安装')

  const clearLogs = async () => {
    setLogsBusy(true)
    try {
      await api.post('/api/mihomo/logs/clear')
      setLogs('')
      toast.success('日志已清空')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setLogsBusy(false)
    }
  }

  const lanText = useMemo(() => {
    const list = status?.network?.lan_interfaces ?? caps?.lan_interfaces ?? []
    return list.length ? list.join(', ') : '未检测到'
  }, [status?.network?.lan_interfaces, caps?.lan_interfaces])

  if (statusPoll.loading && !status) return <Spinner text="加载 Mihomo 状态…" />
  if (statusPoll.error && !status) {
    return <ErrorBox error={statusPoll.error} onRetry={statusPoll.refresh} />
  }

  const running = !!status?.running
  const installed = !!status?.installed
  const safeMode = !!status?.safe_mode

  return (
    <div className="space-y-4">
      <PageHeader
        title="Mihomo"
        desc="代理配置 · 透明网关 · 进程管理"
        extra={
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw size={14} />}
            loading={statusPoll.loading}
            onClick={() => {
              void statusPoll.refresh()
              void refreshCaps()
              void refreshSettings()
            }}
          >
            刷新
          </Button>
        }
      />

      {safeMode && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle size={18} className="shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="font-medium">安全模式已启用</div>
            <div className="text-xs opacity-80">
              mihomo 不会自动启动。确认网络恢复后，再清除安全模式。
              {status?.last_error ? ` 最近错误：${status.last_error}` : ''}
            </div>
          </div>
          <Button variant="secondary" size="sm" loading={busy === 'safe'} onClick={clearSafeMode}>
            清除安全模式
          </Button>
        </div>
      )}

      {status?.last_error && !safeMode && (
        <div className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          <AlertTriangle size={17} className="mt-0.5 shrink-0" />
          <span className="break-all">{status.last_error}</span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="运行状态" icon={<Activity size={17} />}>
          <div className="grid grid-cols-2 gap-4">
            <Stat
              label="进程"
              value={running ? '运行中' : installed ? '已停止' : '未安装'}
              sub={status?.version ?? '尚未安装 mihomo'}
              tone={running ? 'green' : installed ? 'yellow' : 'default'}
              icon={<Shield size={18} />}
            />
            <Stat
              label="实际模式"
              value={status?.effective_mode ?? '--'}
              sub={`请求：${status?.requested_mode ?? '--'}`}
              tone={status?.effective_mode === 'tun' ? 'green' : status?.effective_mode === 'redirect' ? 'yellow' : 'default'}
              icon={<Waypoints size={18} />}
            />
          </div>
          <dl className="mt-3 divide-y divide-slate-100 dark:divide-white/5">
            <KV k="PID" v={status?.pid ?? '--'} mono />
            <KV k="运行时间" v={running ? fmtUptime(status?.uptime_secs) : '--'} />
            <KV k="内存" v={status?.memory_kb ? fmtBytes(status.memory_kb * 1024) : '--'} />
            <KV
              k="控制器"
              v={
                <Badge tone={status?.controller?.reachable ? 'green' : 'slate'}>
                  {status?.controller?.address ?? '--'} · {status?.controller?.reachable ? '可达' : '不可达'}
                </Badge>
              }
            />
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              icon={<Play size={14} />}
              loading={busy === 'start'}
              disabled={!installed || running || safeMode}
              onClick={start}
            >
              启动
            </Button>
            <Button
              variant="secondary"
              icon={<Square size={14} />}
              loading={busy === 'stop'}
              disabled={!running}
              onClick={stop}
            >
              停止
            </Button>
            <Button
              variant="secondary"
              icon={<RotateCcw size={14} />}
              loading={busy === 'restart'}
              disabled={!installed}
              onClick={restart}
            >
              重启
            </Button>
            <Button
              variant="danger"
              icon={<Zap size={14} />}
              loading={busy === 'panic'}
              onClick={() => setConfirmPanic(true)}
            >
              紧急恢复网络
            </Button>
          </div>
        </Card>

        <Card title="透明代理" icon={<Waypoints size={17} />}>
          <div className="space-y-3">
            <Field label="透明代理" inline hint="修改路由/防火墙/DNS；默认关闭">
              <Toggle
                checked={!!settings?.transparent}
                onChange={toggleTransparent}
                disabled={!installed}
              />
            </Field>
            <Field label="接管方式" hint="auto 会优先 TUN，失败回退 REDIRECT">
              <Select
                value={settings?.transparent_mode ?? 'auto'}
                onChange={(e) => void setMode(e.target.value)}
                disabled={!installed}
              >
                <option value="auto">auto（TUN 优先，失败回退）</option>
                <option value="tun">仅 TUN</option>
                <option value="redirect">仅 REDIRECT</option>
              </Select>
            </Field>
            <Field label="REDIRECT 下阻断 QUIC" inline hint="避免 UDP/443 绕过代理">
              <Toggle
                checked={!!settings?.block_quic}
                onChange={(v) => void updateSettings({ block_quic: v }, v ? '已开启 QUIC 阻断' : '已关闭 QUIC 阻断')}
                disabled={!installed}
              />
            </Field>
            <Field label="REDIRECT 下阻断 IPv6" inline hint="默认直连；开启后可能影响局域网 IPv6">
              <Toggle
                checked={!!settings?.block_ipv6}
                onChange={(v) => void updateSettings({ block_ipv6: v }, v ? '已开启 IPv6 阻断' : '已关闭 IPv6 阻断')}
                disabled={!installed}
              />
            </Field>
            <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-white/5 dark:text-slate-400">
              LAN 接口：{lanText}
              <br />
              TUN 代理 LAN + 路由器自身流量；REDIRECT 只代理 LAN IPv4 TCP。
            </div>
          </div>
        </Card>
      </div>

      <Card
        title="代理组 / 节点"
        icon={<Waypoints size={17} />}
        extra={
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw size={13} />}
            loading={proxiesPoll.loading}
            disabled={!running}
            onClick={() => void proxiesPoll.refresh()}
          >
            刷新
          </Button>
        }
      >
        {!running ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            启动 mihomo 后可以在这里切换代理组的节点。
          </p>
        ) : proxiesPoll.loading && !proxyData ? (
          <Spinner text="加载代理组…" />
        ) : proxiesPoll.error ? (
          <ErrorBox error={proxiesPoll.error} onRetry={() => void proxiesPoll.refresh()} />
        ) : !proxyData?.groups?.length ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            当前配置没有代理组。请在 YAML 中添加 <code>proxy-groups</code>（例如 <code>type: select</code>）。
          </p>
        ) : (
          <div className="space-y-3">
            {proxyData.groups.map((group) => {
              const options =
                group.now && !group.all.includes(group.now)
                  ? [group.now, ...group.all]
                  : group.all
              return (
                <div
                  key={group.name}
                  className="rounded-xl border border-slate-200/70 bg-slate-50/60 p-3 dark:border-white/5 dark:bg-white/5"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-medium text-slate-800 dark:text-slate-100">
                      {group.name}
                    </span>
                    <Badge tone={group.selectable ? 'brand' : 'slate'}>{group.type || 'unknown'}</Badge>
                    <span className="text-xs text-slate-400">{group.all.length} 个节点</span>
                  </div>
                  {group.selectable ? (
                    <Select
                      value={group.now ?? ''}
                      onChange={(e) => void selectProxy(group.name, e.target.value)}
                      disabled={proxyBusy === group.name}
                    >
                      <option value="">-- 选择节点 --</option>
                      {options.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      当前：{group.now || '--'}（该组类型不支持手动切换）
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <Card
        title="Mihomo 配置"
        icon={<FileCode2 size={17} />}
        extra={
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>{configMeta?.path ?? '/data/mihomo/config.yaml'}</span>
            {configMeta?.modified_at && <span>· {fmtTime(configMeta.modified_at, true)}</span>}
            <Badge tone={configMeta?.valid ? 'green' : 'yellow'}>
              {configMeta?.valid ? '已校验' : '未校验'}
            </Badge>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              icon={<CheckCircle2 size={14} />}
              loading={configBusy === 'validate'}
              disabled={!installed || !configLoaded}
              onClick={validateConfig}
            >
              校验
            </Button>
            <Button
              size="sm"
              icon={<Save size={14} />}
              loading={configBusy === 'save'}
              disabled={!installed || !configLoaded}
              onClick={() => saveConfig(false)}
            >
              保存
            </Button>
            <Button
              size="sm"
              variant="success"
              icon={<RotateCcw size={14} />}
              loading={configBusy === 'save-restart'}
              disabled={!installed || !configLoaded}
              onClick={() => saveConfig(true)}
            >
              保存并重启
            </Button>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-slate-200/80 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-300/80 dark:bg-white/10 dark:text-slate-200">
              <Upload size={13} /> 载入文件
              <input
                type="file"
                accept=".yaml,.yml,text/yaml"
                className="hidden"
                onChange={(e) => void onConfigFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <Button size="sm" variant="ghost" icon={<Download size={14} />} onClick={downloadConfig}>
              下载
            </Button>
            {configMeta?.effective && (
              <span className="text-xs text-slate-400">
                端口 mixed {configMeta.effective.mixed_port} · redir {configMeta.effective.redir_port} · dns {configMeta.effective.dns_port}
              </span>
            )}
          </div>
          {!configLoaded ? (
            <Spinner text="加载配置…" />
          ) : (
            <textarea
              value={configText}
              onChange={(e) => {
                setConfigText(e.target.value)
                setConfigMeta((m: any) => (m ? { ...m, valid: false } : m))
              }}
              spellCheck={false}
              className="h-96 w-full resize-y rounded-xl border border-slate-300/80 bg-slate-50 p-3 font-mono text-[12px] leading-relaxed text-slate-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-white/10 dark:bg-surface-950 dark:text-slate-200"
            />
          )}
          <p className="text-xs text-slate-400">
            原始配置保存在 <code>/data/mihomo/config.yaml</code>；透明模式会生成运行时副本，不会修改你的 YAML。
          </p>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="安装 / 升级" icon={<Download size={17} />}>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <Badge tone={installed ? 'green' : 'slate'}>{installed ? '已安装' : '未安装'}</Badge>
              {status?.version && <span>版本 {status.version}</span>}
              {status?.binary_size && <span>{fmtBytes(status.binary_size)}</span>}
            </div>
            <Field label="上传二进制" hint="支持 aarch64 ELF 或 .gz；上限 150 MiB">
              <input
                type="file"
                accept=".gz,application/octet-stream"
                className="block w-full text-xs text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-200 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 dark:file:bg-white/10 dark:file:text-slate-200"
                onChange={(e) => setInstallFile(e.target.files?.[0] ?? null)}
              />
            </Field>
            {uploadPct != null && <Progress value={uploadPct} />}
            <Button
              size="sm"
              icon={<Upload size={14} />}
              loading={busy === 'install-upload'}
              disabled={!installFile}
              onClick={uploadInstall}
            >
              上传并安装
            </Button>
            <div className="border-t border-slate-100 pt-3 dark:border-white/5">
              <Field label="在线下载" hint="默认固定 v1.19.32；自定义版本需要提供 .gz SHA256">
                <div className="flex gap-2">
                  <Input
                    value={installVersion}
                    onChange={(e) => {
                      const v = e.target.value
                      setInstallVersion(v)
                      if (v.trim() === DEFAULT_VERSION) setInstallSha(DEFAULT_SHA)
                      else if (installSha === DEFAULT_SHA) setInstallSha('')
                    }}
                    placeholder="v1.19.32"
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Download size={14} />}
                    loading={busy === 'install-download'}
                    onClick={downloadInstall}
                  >
                    下载
                  </Button>
                </div>
              </Field>
              <Input
                className="mt-2 font-mono text-[11px]"
                value={installSha}
                onChange={(e) => setInstallSha(e.target.value)}
                placeholder=".gz SHA256（固定版本可留空）"
              />
            </div>
            <p className="text-xs text-slate-400">
              新二进制安装后需要重启 mihomo 才会生效；旧版本保留为 <code>mihomo.prev</code>。
            </p>
          </div>
        </Card>

        <Card
          title="能力探测"
          icon={<CheckCircle2 size={17} />}
          extra={
            <Button
              size="sm"
              variant="ghost"
              icon={<RefreshCw size={13} />}
              loading={capsBusy}
              onClick={() => void refreshCaps()}
            >
              重新探测
            </Button>
          }
        >
          <dl className="divide-y divide-slate-100 dark:divide-white/5">
            <KV k="TUN" v={<Badge tone={caps?.tun?.available ? 'green' : 'red'}>{caps?.tun?.available ? '可用' : '不可用'}</Badge>} />
            <KV k="iptables" v={<Badge tone={caps?.iptables?.available ? 'green' : 'red'}>{caps?.iptables?.detail || (caps?.iptables?.available ? '可用' : '不可用')}</Badge>} />
            <KV k="nftables" v={<Badge tone={caps?.nftables?.available ? 'green' : 'slate'}>{caps?.nftables?.available ? '可用' : '未检测到'}</Badge>} />
            <KV k="dnsmasq" v={<Badge tone={caps?.dnsmasq?.available ? 'green' : 'red'}>{caps?.dnsmasq?.available ? '运行中' : '不可用'}</Badge>} />
            <KV k="LAN 接口" v={lanText} mono />
          </dl>
          {caps && !caps.tun.available && (
            <p className="mt-3 text-xs text-amber-500">{caps.tun.detail}</p>
          )}
        </Card>
      </div>

      <Card
        title="日志"
        icon={<Terminal size={17} />}
        extra={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} onClick={() => void refreshLogs()}>
              刷新
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 size={13} />}
              loading={logsBusy}
              onClick={clearLogs}
            >
              清空
            </Button>
          </div>
        }
      >
        <pre className="max-h-80 overflow-auto rounded-xl bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-300">
          {logs || '暂无日志'}
        </pre>
      </Card>

      <ConfirmModal
        open={confirmTransparent}
        onClose={() => setConfirmTransparent(false)}
        onConfirm={applyTransparent}
        title="启用透明代理？"
        confirmText="我了解风险，启用"
        danger
        message={
          <div className="space-y-2">
            <p>透明代理会修改路由、防火墙和 DNS，可能导致 LAN 断网。</p>
            <p>默认不会开机自启；失联时可以运行 <code>/data/mihomo/panic.sh</code> 或重启设备。</p>
            <p>请确认你已知晓如何通过 SSH/ADB 恢复。</p>
          </div>
        }
      />

      <ConfirmModal
        open={confirmPanic}
        onClose={() => setConfirmPanic(false)}
        onConfirm={panic}
        title="紧急恢复网络？"
        confirmText="停止并恢复"
        danger
        loading={busy === 'panic'}
        message="将立即停止 mihomo、清理路由/防火墙/DNS，并关闭开机自启、进入安全模式。"
      />
    </div>
  )
}
