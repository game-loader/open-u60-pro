import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Globe,
  KeyRound,
  Link2,
  LogOut,
  Power,
  RefreshCw,
  Save,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from 'lucide-react'
import { api } from '../lib/api'
import { usePolledData } from '../lib/hooks'
import { fmtTime } from '../lib/format'
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
  Spinner,
  Stat,
  Toggle,
  toast,
} from '../components/ui'

type Tone = 'slate' | 'green' | 'red' | 'yellow' | 'brand' | 'blue' | 'purple'

type LastUpdate = {
  version: string
  ok: boolean
  error?: string
  finished_at: number
}

type TailscaleStatus = {
  installed: boolean
  enabled: boolean
  enrolled: boolean
  daemon_running: boolean
  state: string
  backend_state: string | null
  health: string[]
  tailscale_ips: string[] | null
  dns_name: string | null
  relay: string | null
  direct: boolean
  key_expiry: string | null
  expired: boolean
  client_version: string | null
  login_url: string | null
  wakelock_held: boolean
  updating: boolean
  last_update: LastUpdate | null
  hostname: string
  advertise_routes: string[]
  tailscale_ssh: boolean
  hold_wakelock: boolean
  pinned_version: string
  error?: string
}

type ReleaseInfo = {
  version: string
  sha256: string
  arch: string
  tarball?: string
}

const STATE_META: Record<string, { label: string; tone: Tone; hint?: string }> = {
  healthy: { label: '已连接', tone: 'green' },
  degraded: { label: '已连接但离线', tone: 'red', hint: '守护进程在运行，但节点显示离线' },
  connecting: { label: '连接中', tone: 'yellow' },
  starting: { label: '启动中', tone: 'yellow' },
  respawning: { label: '重启中', tone: 'yellow' },
  paused: { label: '已暂停', tone: 'slate' },
  disabled: { label: '已关闭', tone: 'slate' },
  awaiting_setup: { label: '待登录', tone: 'yellow' },
  needs_login: { label: '需要重新登录', tone: 'yellow' },
  pending_approval: { label: '等待设备授权', tone: 'yellow' },
  updating: { label: '更新中', tone: 'yellow' },
  not_installed: { label: '未安装', tone: 'slate' },
  unknown: { label: '未知', tone: 'slate' },
}

function stateMeta(state: string) {
  return STATE_META[state] ?? { label: state || '未知', tone: 'slate' as Tone }
}

function displayDnsName(name: string | null) {
  if (!name) return '--'
  return name.endsWith('.') ? name.slice(0, -1) : name
}

function pathText(status: TailscaleStatus) {
  if (status.direct) return 'Direct'
  if (status.relay) return `Relay · ${status.relay}`
  return 'Relay'
}

function parseDate(value: string | null): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function daysUntil(date: Date | null): number | null {
  if (!date) return null
  const seconds = (date.getTime() - Date.now()) / 1000
  if (seconds < 1) return 0
  return Math.ceil(seconds / 86400)
}

function validVersion(value: string) {
  const v = value.trim()
  return v.length > 0 && /^[0-9.]+$/.test(v)
}

function validSha(value: string) {
  return /^[0-9a-fA-F]{64}$/.test(value.trim())
}

function validHostname(value: string) {
  return /^[A-Za-z0-9-]{1,63}$/.test(value.trim())
}

function validCidr(value: string) {
  const [addr, prefix, extra] = value.trim().split('/')
  if (!addr || !prefix || extra !== undefined) return false
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(addr)) return false
  const octets = addr.split('.').map(Number)
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false
  const p = Number(prefix)
  return Number.isInteger(p) && p >= 0 && p <= 32
}

function parseRoutes(value: string) {
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
}

export default function TailscalePage() {
  const statusPoll = usePolledData<TailscaleStatus>(
    () => api.get('/api/tailscale/status'),
    5000,
  )
  const status = statusPoll.data
  const meta = stateMeta(status?.state ?? 'unknown')

  const [busy, setBusy] = useState('')
  const [authKey, setAuthKey] = useState('')
  const [loginUrl, setLoginUrl] = useState<string | null>(null)
  const [loginPending, setLoginPending] = useState(false)
  const [logoutWarning, setLogoutWarning] = useState<string | null>(null)

  const [hostname, setHostname] = useState('')
  const [routes, setRoutes] = useState('')
  const [holdWake, setHoldWake] = useState(true)
  const [ssh, setSsh] = useState(false)

  const [release, setRelease] = useState<ReleaseInfo | null>(null)
  const [releaseBusy, setReleaseBusy] = useState(false)
  const [updateVersion, setUpdateVersion] = useState('')
  const [updateSha, setUpdateSha] = useState('')
  const [updateSeeded, setUpdateSeeded] = useState(false)
  const [confirmUpdate, setConfirmUpdate] = useState(false)
  const [confirmDisable, setConfirmDisable] = useState(false)
  const [confirmLogout, setConfirmLogout] = useState(false)

  const routesKey = (status?.advertise_routes ?? []).join(',')

  useEffect(() => {
    if (!status) return
    setHostname(status.hostname ?? '')
    setRoutes((status.advertise_routes ?? []).join(', '))
    setHoldWake(!!status.hold_wakelock)
    setSsh(!!status.tailscale_ssh)
  }, [status?.hostname, routesKey, status?.hold_wakelock, status?.tailscale_ssh])

  useEffect(() => {
    if (status?.login_url && status.login_url !== loginUrl) {
      setLoginUrl(status.login_url)
      setLoginPending(false)
    }
  }, [status?.login_url, loginUrl])

  useEffect(() => {
    if (!updateSeeded && !updateVersion && status?.client_version) {
      setUpdateVersion(status.client_version)
      setUpdateSeeded(true)
    }
  }, [status?.client_version, updateSeeded])

  const refresh = () => statusPoll.refresh()

  const run = async (name: string, fn: () => Promise<unknown>, success: string) => {
    setBusy(name)
    try {
      await fn()
      toast.success(success)
      await refresh()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy('')
    }
  }

  const enable = () => run('enable', () => api.post('/api/tailscale/enable'), '已请求启用 Tailscale')
  const disable = () =>
    run('disable', async () => {
      await api.post('/api/tailscale/disable')
      setConfirmDisable(false)
    }, 'Tailscale 已关闭')

  const setup = async () => {
    const key = authKey.trim()
    if (!key) {
      toast.error('请输入 auth key')
      return
    }
    setBusy('setup')
    try {
      await api.post('/api/tailscale/setup', { auth_key: key })
      setAuthKey('')
      setLoginUrl(null)
      toast.success('Tailscale 登录成功')
      await refresh()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy('')
    }
  }

  const requestLoginUrl = async () => {
    setBusy('login')
    try {
      const data = await api.post<any>('/api/tailscale/login-url')
      if (data?.login_url) {
        setLoginUrl(data.login_url)
        setLoginPending(false)
        toast.success('登录链接已生成')
      } else {
        setLoginPending(true)
        toast.info('等待 Tailscale 生成登录链接…')
      }
      await refresh()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy('')
    }
  }

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('已复制')
    } catch {
      toast.error('复制失败，请手动选择文本')
    }
  }

  const saveConfig = async () => {
    if (!validHostname(hostname)) {
      toast.error('Hostname 只能使用 1-63 个字母、数字或连字符')
      return
    }
    const routeList = parseRoutes(routes)
    if (routeList.some((r) => !validCidr(r))) {
      toast.error('路由必须是 IPv4 CIDR，例如 192.168.0.0/24')
      return
    }
    setBusy('config')
    try {
      await api.put('/api/tailscale/config', {
        hostname: hostname.trim(),
        advertise_routes: routeList,
        hold_wakelock: holdWake,
        tailscale_ssh: ssh,
      })
      toast.success('Tailscale 设置已保存')
      await refresh()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy('')
    }
  }

  const checkRelease = async () => {
    setReleaseBusy(true)
    try {
      const data = await api.get<ReleaseInfo>('/api/tailscale/release')
      setRelease(data)
      setUpdateVersion(data.version)
      setUpdateSha(data.sha256)
      toast.success(`最新稳定版：${data.version}`)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setReleaseBusy(false)
    }
  }

  const confirmInstallUpdate = () => {
    if (!validVersion(updateVersion)) {
      toast.error('版本号只能包含数字和点')
      return
    }
    if (!validSha(updateSha)) {
      toast.error('SHA256 必须是 64 位十六进制')
      return
    }
    setConfirmUpdate(true)
  }

  const installUpdate = async () => {
    setBusy('update')
    try {
      await api.post('/api/tailscale/update', {
        version: updateVersion.trim(),
        sha256: updateSha.trim(),
      })
      setConfirmUpdate(false)
      toast.success('已开始安装/更新，状态会自动刷新')
      await refresh()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy('')
    }
  }

  const logout = async () => {
    setBusy('logout')
    try {
      const data = await api.post<any>('/api/tailscale/logout')
      setConfirmLogout(false)
      setLogoutWarning(data?.warning ?? null)
      setLoginUrl(null)
      toast.success('已登出 Tailscale')
      await refresh()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy('')
    }
  }

  const ips = status?.tailscale_ips ?? []
  const keyExpiryDate = parseDate(status?.key_expiry ?? null)
  const keyDays = daysUntil(keyExpiryDate)
  const health = status?.health ?? []
  const wakelockFailing = !!status?.enabled && !!status?.hold_wakelock && !status?.wakelock_held
  const versionMismatch =
    !!status?.pinned_version &&
    !!status?.client_version &&
    status.pinned_version !== status.client_version
  const installed = !!status?.installed
  const enrolled = !!status?.enrolled
  const enabled = !!status?.enabled
  const updating = !!status?.updating
  const needsLogin = !enrolled || status?.state === 'needs_login' || !!status?.expired

  const routeSummary = useMemo(() => {
    if (!status) return '--'
    return (status.advertise_routes ?? []).length ? status.advertise_routes.join(', ') : '未宣告'
  }, [status])

  if (statusPoll.loading && !status) return <Spinner text="加载 Tailscale 状态…" />
  if (statusPoll.error && !status) {
    return <ErrorBox error={statusPoll.error} onRetry={statusPoll.refresh} />
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Tailscale"
        desc="远程访问 · 设备登录 · 路由与版本"
        extra={
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw size={14} />}
            loading={statusPoll.loading}
            onClick={() => void refresh()}
          >
            刷新
          </Button>
        }
      />

      {enabled && (
        <div className="flex items-start gap-2 rounded-2xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <ShieldAlert size={17} className="mt-0.5 shrink-0" />
          <span>
            如果你正在通过 Tailscale 远程访问本页面，关闭、登出或更新会立即断开连接。
            请确保你有本地网络或 SSH/ADB 访问权限。
          </span>
        </div>
      )}

      {logoutWarning && (
        <div className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          <AlertTriangle size={17} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">已登出，但节点 key 可能没有失效</div>
            <div className="mt-1 break-all font-mono text-xs">{logoutWarning}</div>
            <div className="mt-1 text-xs opacity-80">
              请到
              <a
                href="https://login.tailscale.com/admin/machines"
                target="_blank"
                rel="noreferrer"
                className="mx-1 underline"
              >
                Tailscale 管理后台
              </a>
              删除这台机器。
            </div>
            <Button size="sm" variant="ghost" className="mt-2" onClick={() => setLogoutWarning(null)}>
              知道了
            </Button>
          </div>
        </div>
      )}

      {!!status?.error && (
        <div className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          <XCircle size={17} className="mt-0.5 shrink-0" />
          <span className="break-all">{status.error}</span>
        </div>
      )}

      {health.length > 0 && (
        <div className="rounded-2xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle size={16} /> Tailscale 健康警告
          </div>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
            {health.map((h, i) => (
              <li key={`${i}-${h}`} className="break-all">{h}</li>
            ))}
          </ul>
        </div>
      )}

      {wakelockFailing && (
        <div className="flex items-start gap-2 rounded-2xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <Clock size={17} className="mt-0.5 shrink-0" />
          <span>“保持路由器唤醒”已开启，但路由器拒绝了 wakelock，设备可能休眠后失联。</span>
        </div>
      )}

      {status?.expired && (
        <div className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          <AlertTriangle size={17} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">节点 key 已过期</div>
            <div className="mt-1 text-xs opacity-80">
              远程访问已中断，需要重新登录；请同时到 Tailscale 管理后台检查该机器的 key 过期设置。
            </div>
          </div>
        </div>
      )}

      {!status?.expired && keyDays != null && keyDays <= 14 && (
        <div className="flex items-start gap-2 rounded-2xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <Clock size={17} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">节点 key 将在 {keyDays} 天后过期</div>
            <div className="mt-1 text-xs opacity-80">
              过期后远程访问会停止，只能从局域网恢复。建议在
              <a
                href="https://login.tailscale.com/admin/machines"
                target="_blank"
                rel="noreferrer"
                className="mx-1 underline"
              >
                Tailscale 管理后台
              </a>
              为该机器关闭 key expiry。
            </div>
          </div>
        </div>
      )}

      {versionMismatch && (
        <div className="flex items-start gap-2 rounded-2xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle size={17} className="mt-0.5 shrink-0" />
          <span>
            固定版本 {status?.pinned_version} 与运行版本 {status?.client_version} 不一致，更新可能没有生效。
          </span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="连接状态" icon={<Globe size={17} />}>
          <div className="grid grid-cols-2 gap-4">
            <Stat
              label="Tailscale"
              value={meta.label}
              sub={meta.hint ?? status?.backend_state ?? '—'}
              tone={meta.tone === 'green' ? 'green' : meta.tone === 'red' ? 'red' : meta.tone === 'yellow' ? 'yellow' : 'default'}
              icon={meta.tone === 'green' ? <ShieldCheck size={18} /> : <Globe size={18} />}
            />
            <Stat
              label="客户端版本"
              value={status?.client_version ?? '--'}
              sub={status?.pinned_version ? `固定：${status.pinned_version}` : '未固定版本'}
              icon={<Download size={18} />}
            />
          </div>
          <dl className="mt-3 divide-y divide-slate-100 dark:divide-white/5">
            <KV k="Tailscale IP" v={ips.length ? ips.join(', ') : '--'} mono />
            <KV k="DNS 名" v={displayDnsName(status?.dns_name ?? null)} mono />
            <KV k="连接路径" v={status ? pathText(status) : '--'} />
            <KV
              k="Key 过期"
              v={
                status?.expired ? (
                  <Badge tone="red">已过期</Badge>
                ) : !status?.key_expiry ? (
                  <Badge tone="green">永不过期</Badge>
                ) : keyDays != null && keyDays <= 14 ? (
                  <Badge tone="yellow">{keyDays} 天后</Badge>
                ) : (
                  keyExpiryDate?.toLocaleString() ?? status?.key_expiry ?? '--'
                )
              }
            />
            <KV k="守护进程" v={status?.daemon_running ? '运行中' : '未运行'} />
            <KV k="状态机" v={status?.state ?? '--'} mono />
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            {!enabled ? (
              <Button
                icon={<Power size={14} />}
                loading={busy === 'enable'}
                disabled={!installed || updating}
                onClick={enable}
              >
                启用远程访问
              </Button>
            ) : (
              <Button
                variant="secondary"
                icon={<Power size={14} />}
                loading={busy === 'disable'}
                disabled={updating}
                onClick={() => setConfirmDisable(true)}
              >
                关闭远程访问
              </Button>
            )}
            {enrolled && (
              <Button
                variant="danger"
                icon={<LogOut size={14} />}
                loading={busy === 'logout'}
                disabled={updating}
                onClick={() => setConfirmLogout(true)}
              >
                登出
              </Button>
            )}
          </div>
        </Card>

        <Card title="登录" icon={<KeyRound size={17} />}>
          {enrolled && !needsLogin ? (
            <div className="flex items-start gap-2 text-sm text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 size={17} className="mt-0.5 shrink-0" />
              <div>
                <div className="font-medium">已登录 Tailscale</div>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  节点：{displayDnsName(status?.dns_name ?? null)}
                  {ips.length ? ` · ${ips.join(', ')}` : ''}
                </div>
              </div>
            </div>
          ) : !installed ? (
            <div className="text-sm text-slate-500 dark:text-slate-400">
              先安装 Tailscale 二进制，然后再登录。
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-white/5 dark:text-slate-400">
                启用远程访问前请确保 agent 已设置密码，否则 Tailscale 会把完整管理 API 暴露给整个 tailnet。
              </div>
              {enrolled && (
                <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                  这台设备已登录但当前需要重新认证。auth key 登录会被拒绝；请使用下面的浏览器登录，或先登出再重新登录。
                </div>
              )}
              <Field
                label="Auth key"
                hint="只在本次请求中使用，不会保存。可在 Tailscale 管理后台创建。"
              >
                <div className="flex gap-2">
                  <Input
                    type="password"
                    value={authKey}
                    onChange={(e) => setAuthKey(e.target.value)}
                    placeholder="tskey-auth-..."
                    autoComplete="off"
                  />
                  <Button
                    size="sm"
                    icon={<ShieldCheck size={14} />}
                    loading={busy === 'setup'}
                    disabled={!authKey.trim() || updating}
                    onClick={setup}
                  >
                    登录
                  </Button>
                </div>
              </Field>
              <div className="border-t border-slate-100 pt-3 dark:border-white/5">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300">
                  <Link2 size={15} /> 或使用浏览器登录
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<ExternalLink size={14} />}
                  loading={busy === 'login'}
                  disabled={updating}
                  onClick={requestLoginUrl}
                >
                  生成登录链接
                </Button>
                {loginPending && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
                    <Spinner text="等待登录链接…" />
                  </div>
                )}
                {loginUrl && (
                  <div className="mt-2 space-y-2">
                    <a
                      href={loginUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="block break-all rounded-lg bg-slate-100 px-3 py-2 text-xs text-brand-600 hover:underline dark:bg-white/5 dark:text-brand-300"
                    >
                      {loginUrl}
                    </a>
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" icon={<Copy size={13} />} onClick={() => void copy(loginUrl)}>
                        复制链接
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<ExternalLink size={13} />}
                        onClick={() => window.open(loginUrl, '_blank', 'noopener,noreferrer')}
                      >
                        打开
                      </Button>
                    </div>
                  </div>
                )}
              </div>
              <div className="text-xs text-slate-400">
                还没有 auth key？
                <a
                  href="https://login.tailscale.com/admin/settings/keys"
                  target="_blank"
                  rel="noreferrer"
                  className="ml-1 text-brand-500 hover:underline"
                >
                  打开 Tailscale 密钥页面
                </a>
              </div>
            </div>
          )}
        </Card>
      </div>

      {enrolled && (
        <Card title="Tailscale 设置" icon={<Globe size={17} />}>
          <div className="grid gap-4 lg:grid-cols-2">
            <Field label="Hostname" hint="1-63 个字母、数字或连字符">
              <Input value={hostname} onChange={(e) => setHostname(e.target.value)} />
            </Field>
            <Field label="Advertise routes" hint="逗号分隔的 IPv4 CIDR；留空表示不宣告">
              <Input
                value={routes}
                onChange={(e) => setRoutes(e.target.value)}
                placeholder="192.168.0.0/24, 10.0.0.0/8"
              />
            </Field>
            <Field label="保持路由器唤醒" inline hint="启用 Tailscale 时创建 wakelock">
              <Toggle checked={holdWake} onChange={setHoldWake} disabled={updating} />
            </Field>
            <Field label="Tailscale SSH" inline hint="允许 tailnet 通过 Tailscale SSH 登录">
              <Toggle checked={ssh} onChange={setSsh} disabled={updating} />
            </Field>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Button
              icon={<Save size={14} />}
              loading={busy === 'config'}
              disabled={updating}
              onClick={saveConfig}
            >
              保存设置
            </Button>
            <span className="text-xs text-slate-400">当前宣告：{routeSummary}</span>
          </div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="安装 / 升级" icon={<Download size={17} />}>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <Badge tone={installed ? 'green' : 'slate'}>{installed ? '已安装' : '未安装'}</Badge>
              {status?.client_version && <span>运行 {status.client_version}</span>}
              {status?.pinned_version && <span>固定 {status.pinned_version}</span>}
              {release && <Badge tone="brand">最新 {release.version}</Badge>}
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <Button
                size="sm"
                variant="secondary"
                icon={<RefreshCw size={13} />}
                loading={releaseBusy}
                onClick={checkRelease}
              >
                检查最新版本
              </Button>
              {release && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Download size={13} />}
                  onClick={() => {
                    setUpdateVersion(release.version)
                    setUpdateSha(release.sha256)
                  }}
                >
                  填入最新版
                </Button>
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Version" hint="只填数字和点，例如 1.98.9">
                <Input
                  value={updateVersion}
                  onChange={(e) => setUpdateVersion(e.target.value)}
                  placeholder="1.98.9"
                  disabled={updating}
                />
              </Field>
              <Field label="SHA256" hint="来自 pkgs.tailscale.com 的 .tgz.sha256">
                <Input
                  value={updateSha}
                  onChange={(e) => setUpdateSha(e.target.value)}
                  placeholder="64 位十六进制"
                  className="font-mono text-[11px]"
                  disabled={updating}
                />
              </Field>
            </div>
            <Button
              icon={<Download size={14} />}
              loading={busy === 'update' || updating}
              disabled={updating || !updateVersion || !updateSha}
              onClick={confirmInstallUpdate}
            >
              {installed ? '安装 / 更新 Tailscale' : '安装 Tailscale'}
            </Button>
            {updating && (
              <div className="flex items-center gap-2 text-xs text-amber-500">
                <Spinner text="正在下载/安装，可能需要几分钟…" />
              </div>
            )}
            {status?.last_update && (
              <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-white/5 dark:text-slate-400">
                <div className="flex items-center gap-1.5">
                  {status.last_update.ok ? (
                    <CheckCircle2 size={14} className="text-emerald-500" />
                  ) : (
                    <XCircle size={14} className="text-red-500" />
                  )}
                  上次更新 {status.last_update.version}
                  {status.last_update.finished_at ? ` · ${fmtTime(status.last_update.finished_at, true)}` : ''}
                </div>
                {status.last_update.error && (
                  <div className="mt-1 break-all text-red-500">{status.last_update.error}</div>
                )}
              </div>
            )}
            <p className="text-xs text-slate-400">
              更新会短暂重启 tailscaled；如果你正在通过 Tailscale 连接，会立即断开。
            </p>
          </div>
        </Card>

        <Card title="设备信息" icon={<Globe size={17} />}>
          <dl className="divide-y divide-slate-100 dark:divide-white/5">
            <KV k="Backend" v={status?.backend_state ?? '--'} mono />
            <KV k="Hostname" v={status?.hostname ?? '--'} mono />
            <KV k="Advertise" v={routeSummary} mono />
            <KV k="Tailscale SSH" v={status?.tailscale_ssh ? '已开启' : '已关闭'} />
            <KV k="Wakelock" v={status?.wakelock_held ? '已持有' : status?.hold_wakelock ? '请求失败' : '未请求'} />
            <KV k="Pinned version" v={status?.pinned_version || '--'} mono />
          </dl>
          {status?.state === 'pending_approval' && (
            <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
              这台设备正在等待 Tailscale 管理后台授权。
              <a
                href="https://login.tailscale.com/admin/machines"
                target="_blank"
                rel="noreferrer"
                className="ml-1 underline"
              >
                打开 Machines
              </a>
            </div>
          )}
        </Card>
      </div>

      <ConfirmModal
        open={confirmDisable}
        onClose={() => setConfirmDisable(false)}
        onConfirm={disable}
        title="关闭 Tailscale 远程访问？"
        confirmText="关闭"
        danger
        loading={busy === 'disable'}
        message="会停止 tailscaled 并断开所有 Tailscale 连接。如果你正在通过 Tailscale 访问本页面，当前连接会立即断开。"
      />

      <ConfirmModal
        open={confirmLogout}
        onClose={() => setConfirmLogout(false)}
        onConfirm={logout}
        title="登出 Tailscale？"
        confirmText="登出"
        danger
        loading={busy === 'logout'}
        message="会尝试使这台设备的节点 key 失效并关闭 Tailscale。如果 key 未能失效，页面会显示警告，你需要到 Tailscale 管理后台手动删除这台机器。"
      />

      <ConfirmModal
        open={confirmUpdate}
        onClose={() => setConfirmUpdate(false)}
        onConfirm={installUpdate}
        title={installed ? '安装 / 更新 Tailscale？' : '安装 Tailscale？'}
        confirmText={installed ? '开始更新' : '开始安装'}
        danger={enabled}
        loading={busy === 'update'}
        message={
          <div className="space-y-2">
            <p>
              将安装 Tailscale {updateVersion || '?'}（aarch64）。下载源为 pkgs.tailscale.com，
              需要设备能访问互联网。
            </p>
            {enabled && <p>更新会重启 tailscaled；通过 Tailscale 连接会立即断开。</p>}
          </div>
        }
      />
    </div>
  )
}
