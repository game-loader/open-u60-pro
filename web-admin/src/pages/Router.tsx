import { useEffect, useState } from 'react'
import {
  Globe,
  Network,
  Shield,
  KeyRound,
  Gauge,
  ListFilter,
  Plus,
  Trash2,
  Save,
  Database,
  Cloud,
  ShieldCheck,
  X,
} from 'lucide-react'
import { api } from '../lib/api'
import { useAsync } from '../lib/hooks'
import { num0 } from '../lib/format'
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
  Tabs,
  Spinner,
  ErrorBox,
  EmptyState,
  PageHeader,
  toast,
} from '../components/ui'

/* ---------- 工具 ---------- */

/** API 里开关值可能是 "1"/1/true/"on"/"enable" */
function asBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  const s = String(v ?? '').toLowerCase()
  return s === '1' || s === 'true' || s === 'on' || s === 'enable'
}

function isIPv4(s: string): boolean {
  const parts = s.split('.')
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
}

function TabBody({ q, children }: { q: { loading: boolean; error: string | null; data: any; refresh: () => void }; children: React.ReactNode }) {
  if (q.loading && !q.data) {
    return (
      <Card>
        <Spinner />
      </Card>
    )
  }
  if (q.error && !q.data) {
    return (
      <Card>
        <ErrorBox error={q.error} onRetry={q.refresh} />
      </Card>
    )
  }
  return <>{children}</>
}

/* ---------- DNS ---------- */

function DnsTab() {
  const dns = useAsync(() => api.get('/api/router/dns'), [])
  const doh = useAsync(() => api.get('/api/doh/status'), [])
  const cache = useAsync(() => api.get('/api/doh/cache'), [])

  const [mode, setMode] = useState<'auto' | 'manual'>('auto')
  const [servers, setServers] = useState<string[]>([])
  const [newIp, setNewIp] = useState('')
  const [savingDns, setSavingDns] = useState(false)

  const [upstream, setUpstream] = useState('')
  const [timeoutMs, setTimeoutMs] = useState('3000')
  const [cacheEnabled, setCacheEnabled] = useState(true)
  const [cacheMax, setCacheMax] = useState('512')
  const [savingDohCfg, setSavingDohCfg] = useState(false)
  const [dohBusy, setDohBusy] = useState(false)
  const [confirmDisable, setConfirmDisable] = useState(false)
  const [clearing, setClearing] = useState(false)

  useEffect(() => {
    if (dns.data) {
      setMode(dns.data.dns_mode === 'manual' ? 'manual' : 'auto')
      const list = [dns.data.prefer_dns_manual, dns.data.standby_dns_manual].filter(
        (s: unknown) => typeof s === 'string' && (s as string).length > 0,
      )
      setServers(list as string[])
    }
  }, [dns.data])

  useEffect(() => {
    const c = doh.data?.config
    if (c) {
      setUpstream(String(c.upstream_url ?? ''))
      setTimeoutMs(String(c.timeout_ms ?? 3000))
      setCacheEnabled(c.cache_enabled !== false)
      setCacheMax(String(c.cache_max_entries ?? 512))
    }
  }, [doh.data])

  const addServer = () => {
    const ip = newIp.trim()
    if (!isIPv4(ip)) {
      toast.error('请输入合法的 IPv4 地址')
      return
    }
    if (servers.includes(ip)) {
      toast.error('该 DNS 服务器已存在')
      return
    }
    if (servers.length >= 2) {
      toast.error('最多支持 2 个 DNS 服务器（首选 + 备用）')
      return
    }
    setServers([...servers, ip])
    setNewIp('')
  }

  const saveDns = async () => {
    if (mode === 'manual' && servers.length === 0) {
      toast.error('手动模式下至少需要一个 DNS 服务器')
      return
    }
    setSavingDns(true)
    try {
      await api.put('/api/router/dns', {
        dns_mode: mode,
        prefer_dns_manual: mode === 'manual' ? servers[0] ?? '' : '',
        standby_dns_manual: mode === 'manual' ? servers[1] ?? '' : '',
      })
      toast.success('DNS 设置已保存')
      dns.refresh()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSavingDns(false)
    }
  }

  const setDoh = async (enable: boolean) => {
    setDohBusy(true)
    try {
      await api.post(enable ? '/api/doh/enable' : '/api/doh/disable')
      toast.success(enable ? 'DoH 已启用，DNS 查询将加密转发' : 'DoH 已禁用，恢复普通 DNS')
      doh.refresh()
      if (enable) cache.refresh()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setDohBusy(false)
      setConfirmDisable(false)
    }
  }

  const saveDohCfg = async () => {
    if (!upstream.trim()) {
      toast.error('DoH 上游服务器不能为空')
      return
    }
    setSavingDohCfg(true)
    try {
      await api.put('/api/doh/config', {
        upstream_url: upstream.trim(),
        timeout_ms: num0(timeoutMs),
        cache_enabled: cacheEnabled,
        cache_max_entries: num0(cacheMax),
      })
      toast.success('DoH 配置已保存')
      doh.refresh()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSavingDohCfg(false)
    }
  }

  const clearCache = async () => {
    setClearing(true)
    try {
      await api.post('/api/doh/cache/clear')
      toast.success('DNS 缓存已清空')
      cache.refresh()
      doh.refresh()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setClearing(false)
    }
  }

  const running = doh.data?.running === true
  const stats = doh.data?.stats
  const hits = num0(stats?.cache_hits)
  const misses = num0(stats?.cache_misses)
  const hitRatio = hits + misses > 0 ? ((hits / (hits + misses)) * 100).toFixed(1) : '--'
  const cacheList: any[] = Array.isArray(cache.data) ? cache.data : []

  return (
    <div className="space-y-4">
      {/* DNS 服务器 */}
      <Card title="DNS 服务器" icon={<Globe size={15} />}>
        <TabBody q={dns}>
          <div className="space-y-3">
            <Field label="获取方式">
              <Select value={mode} onChange={(e) => setMode(e.target.value as 'auto' | 'manual')}>
                <option value="auto">自动获取（运营商下发）</option>
                <option value="manual">手动设置</option>
              </Select>
            </Field>

            {mode === 'manual' && (
              <div className="space-y-2">
                {servers.map((ip, i) => (
                  <div key={ip} className="flex items-center gap-2">
                    <span className="w-12 shrink-0 text-xs text-slate-400">{i === 0 ? '首选' : '备用'}</span>
                    <span className="tabular min-w-0 flex-1 truncate rounded-lg bg-slate-100 px-3 py-1.5 font-mono text-sm dark:bg-white/5">
                      {ip}
                    </span>
                    <Button size="sm" variant="ghost" icon={<X size={13} />} onClick={() => setServers(servers.filter((s) => s !== ip))}>
                      删除
                    </Button>
                  </div>
                ))}
                {servers.length < 2 && (
                  <div className="flex items-center gap-2">
                    <Input
                      value={newIp}
                      onChange={(e) => setNewIp(e.target.value)}
                      placeholder="如 223.5.5.5"
                      className="font-mono"
                      onKeyDown={(e) => e.key === 'Enter' && addServer()}
                    />
                    <Button size="sm" variant="secondary" icon={<Plus size={13} />} onClick={addServer}>
                      添加
                    </Button>
                  </div>
                )}
                <p className="text-xs text-slate-400 dark:text-slate-500">最多 2 个 DNS 服务器（首选 + 备用）</p>
              </div>
            )}

            <div className="flex justify-end">
              <Button icon={<Save size={14} />} loading={savingDns} onClick={saveDns}>
                保存
              </Button>
            </div>
          </div>
        </TabBody>
      </Card>

      {/* DoH */}
      <Card
        title="DNS over HTTPS (DoH)"
        icon={<Cloud size={15} />}
        extra={
          doh.data ? (
            running ? <Badge tone="green">已启用</Badge> : <Badge tone="slate">未启用</Badge>
          ) : undefined
        }
      >
        <TabBody q={doh}>
          <dl className="divide-y divide-slate-100 dark:divide-white/5">
            <KV k="监听地址" v={doh.data?.config?.listen_addr} mono />
            <KV k="查询总数" v={<span className="tabular">{num0(stats?.queries_total)}</span>} />
            <KV k="缓存命中率" v={<span className="tabular">{hitRatio}%</span>} />
            <KV k="缓存条目" v={<span className="tabular">{num0(stats?.cache_entries)}</span>} />
          </dl>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="上游服务器" hint="DoH 查询 URL，如 https://1.1.1.1/dns-query">
              <Input value={upstream} onChange={(e) => setUpstream(e.target.value)} className="font-mono" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="超时 (ms)">
                <Input value={timeoutMs} onChange={(e) => setTimeoutMs(e.target.value)} inputMode="numeric" />
              </Field>
              <Field label="缓存上限">
                <Input value={cacheMax} onChange={(e) => setCacheMax(e.target.value)} inputMode="numeric" />
              </Field>
            </div>
          </div>
          <Field label="启用缓存" inline>
            <Toggle checked={cacheEnabled} onChange={setCacheEnabled} />
          </Field>

          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button variant="secondary" icon={<Save size={14} />} loading={savingDohCfg} onClick={saveDohCfg}>
              保存配置
            </Button>
            {running ? (
              <Button variant="danger" loading={dohBusy} onClick={() => setConfirmDisable(true)}>
                禁用 DoH
              </Button>
            ) : (
              <Button variant="success" icon={<ShieldCheck size={14} />} loading={dohBusy} onClick={() => setDoh(true)}>
                启用 DoH
              </Button>
            )}
          </div>
        </TabBody>
      </Card>

      {/* DoH 缓存 */}
      <Card
        title="DoH 缓存"
        icon={<Database size={15} />}
        extra={
          <div className="flex items-center gap-2">
            <Badge tone="brand">{cacheList.length} 条</Badge>
            <Button size="sm" variant="secondary" icon={<Trash2 size={13} />} loading={clearing} onClick={clearCache}>
              清空
            </Button>
          </div>
        }
      >
        {cacheList.length === 0 ? (
          <EmptyState text="暂无缓存条目" />
        ) : (
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400">
                  <th className="pb-2 font-medium">域名</th>
                  <th className="w-16 pb-2 font-medium">类型</th>
                  <th className="w-20 pb-2 text-right font-medium">TTL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {cacheList.map((e: any, i: number) => (
                  <tr key={`${e.domain}-${e.type_id}-${i}`}>
                    <td className="max-w-0 truncate py-2 pr-2 font-mono text-xs">{e.domain}</td>
                    <td className="py-2 pr-2">
                      <Badge tone="blue">{e.type}</Badge>
                    </td>
                    <td className="tabular py-2 text-right text-xs text-slate-400">{e.ttl}s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmModal
        open={confirmDisable}
        onClose={() => setConfirmDisable(false)}
        onConfirm={() => setDoh(false)}
        title="禁用 DoH"
        message="禁用后将恢复为普通 DNS 查询，域名解析不再加密。确定禁用 DoH 吗？"
        loading={dohBusy}
        confirmText="禁用"
      />
    </div>
  )
}

/* ---------- LAN / DHCP ---------- */

function LanTab() {
  const q = useAsync(() => api.get('/api/router/lan'), [])
  const [ip, setIp] = useState('')
  const [netmask, setNetmask] = useState('')
  const [dhcpOn, setDhcpOn] = useState(true)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [lease, setLease] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (q.data) {
      setIp(String(q.data.lan_ipaddr ?? ''))
      setNetmask(String(q.data.lan_netmask ?? ''))
      setDhcpOn(asBool(q.data.dhcp_enable))
      setStart(String(q.data.dhcp_start ?? ''))
      setEnd(String(q.data.dhcp_end ?? ''))
      setLease(String(q.data.dhcp_lease_time ?? ''))
    }
  }, [q.data])

  const save = async () => {
    if (!isIPv4(ip)) {
      toast.error('LAN IP 地址不合法')
      return
    }
    if (!isIPv4(netmask)) {
      toast.error('子网掩码不合法')
      return
    }
    setSaving(true)
    try {
      await api.put('/api/router/lan', {
        lan_ipaddr: ip,
        lan_netmask: netmask,
        dhcp_enable: dhcpOn ? '1' : '0',
        dhcp_start: start,
        dhcp_end: end,
        dhcp_lease_time: lease,
      })
      toast.success('LAN 设置已保存，若修改了 IP 地址请使用新地址重新连接')
      q.refresh()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card title="LAN / DHCP 设置" icon={<Network size={15} />}>
      <TabBody q={q}>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="LAN IP 地址">
              <Input value={ip} onChange={(e) => setIp(e.target.value)} className="font-mono" />
            </Field>
            <Field label="子网掩码">
              <Input value={netmask} onChange={(e) => setNetmask(e.target.value)} className="font-mono" />
            </Field>
          </div>
          <Field label="DHCP 服务器" inline>
            <Toggle checked={dhcpOn} onChange={setDhcpOn} />
          </Field>
          {dhcpOn && (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="地址池起始偏移" hint="相对于 LAN IP，如 100">
                <Input value={start} onChange={(e) => setStart(e.target.value)} inputMode="numeric" />
              </Field>
              <Field label="地址池结束地址">
                <Input value={end} onChange={(e) => setEnd(e.target.value)} className="font-mono" />
              </Field>
              <Field label="租约时间" hint="如 12h">
                <Input value={lease} onChange={(e) => setLease(e.target.value)} />
              </Field>
            </div>
          )}
          <div className="flex justify-end">
            <Button icon={<Save size={14} />} loading={saving} onClick={save}>
              保存
            </Button>
          </div>
        </div>
      </TabBody>
    </Card>
  )
}

/* ---------- 防火墙 ---------- */

interface PfRule {
  id: string
  name: string
  protocol: string
  wan_port: string
  lan_ip: string
  lan_port: string
  enabled: boolean
}

function FirewallTab() {
  const fw = useAsync(() => api.get('/api/router/firewall'), [])
  const upnp = useAsync(() => api.get('/api/router/firewall/upnp'), [])
  const pf = useAsync(() => api.get('/api/router/firewall/port-forward'), [])
  const fr = useAsync(() => api.get('/api/router/firewall/filter-rules'), [])

  const [busy, setBusy] = useState<string | null>(null)
  const [dmzOn, setDmzOn] = useState(false)
  const [dmzIp, setDmzIp] = useState('')
  const [savingDmz, setSavingDmz] = useState(false)

  const [addOpen, setAddOpen] = useState(false)
  const [fName, setFName] = useState('')
  const [fProto, setFProto] = useState('tcp')
  const [fWanPort, setFWanPort] = useState('')
  const [fLanIp, setFLanIp] = useState('')
  const [fLanPort, setFLanPort] = useState('')
  const [adding, setAdding] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  useEffect(() => {
    if (fw.data) {
      setDmzOn(asBool(fw.data.dmz_enabled))
      setDmzIp(String(fw.data.dmz_ip ?? ''))
    }
  }, [fw.data])

  /** 开关类操作：成功后更新本地数据，失败不改 state（自动回滚） */
  const act = async (key: string, path: string, body: unknown, okMsg: string, patch?: Record<string, unknown>) => {
    setBusy(key)
    try {
      await api.put(path, body)
      if (patch && fw.data) fw.setData({ ...fw.data, ...patch })
      toast.success(okMsg)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(null)
    }
  }

  const saveDmz = async () => {
    if (dmzOn && !isIPv4(dmzIp)) {
      toast.error('DMZ 主机 IP 不合法')
      return
    }
    setSavingDmz(true)
    try {
      await api.put('/api/router/firewall/dmz', { dmz_enabled: dmzOn ? '1' : '0', dmz_ip: dmzIp })
      if (fw.data) fw.setData({ ...fw.data, dmz_enabled: dmzOn ? '1' : '0', dmz_ip: dmzIp })
      toast.success('DMZ 设置已保存')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSavingDmz(false)
    }
  }

  const toggleUpnp = async (v: boolean) => {
    setBusy('upnp')
    try {
      await api.put('/api/router/firewall/upnp', { upnp_switch: v ? '1' : '0' })
      if (upnp.data) upnp.setData({ ...upnp.data, upnp_switch: v ? '1' : '0' })
      toast.success(v ? 'UPnP 已开启' : 'UPnP 已关闭')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(null)
    }
  }

  const togglePfSwitch = async (v: boolean) => {
    setBusy('pf')
    try {
      await api.put('/api/router/firewall/port-forward/switch', { port_forward_switch: v ? '1' : '0' })
      if (fw.data) fw.setData({ ...fw.data, port_forward_switch: v ? '1' : '0' })
      toast.success(v ? '端口转发已开启' : '端口转发已关闭')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(null)
    }
  }

  const addRule = async () => {
    if (!fName.trim()) {
      toast.error('请填写规则名称')
      return
    }
    if (!fWanPort.trim() || !fLanPort.trim()) {
      toast.error('请填写端口')
      return
    }
    if (!isIPv4(fLanIp)) {
      toast.error('内部 IP 不合法')
      return
    }
    setAdding(true)
    try {
      await api.post('/api/router/firewall/port-forward', {
        action: 'add',
        name: fName.trim(),
        protocol: fProto,
        wan_port: fWanPort.trim(),
        lan_ip: fLanIp.trim(),
        lan_port: fLanPort.trim(),
        enabled: '1',
      })
      toast.success('端口转发规则已添加')
      setAddOpen(false)
      setFName(''); setFWanPort(''); setFLanIp(''); setFLanPort('')
      pf.refresh()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setAdding(false)
    }
  }

  const delRule = async (rule: PfRule) => {
    setDeleting(rule.id)
    try {
      await api.post('/api/router/firewall/port-forward', { action: 'delete', id: rule.id })
      toast.success(`规则「${rule.name}」已删除`)
      pf.refresh()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setDeleting(null)
    }
  }

  const pfRules: PfRule[] = (pf.data?.rule_list ?? []).map((r: any, i: number) => ({
    id: String(r.id ?? i),
    name: String(r.name ?? ''),
    protocol: String(r.protocol ?? ''),
    wan_port: String(r.wan_port ?? ''),
    lan_ip: String(r.lan_ip ?? ''),
    lan_port: String(r.lan_port ?? ''),
    enabled: asBool(r.enabled),
  }))
  const filterRules: any[] = fr.data?.rule_list ?? []

  return (
    <div className="space-y-4">
      {/* 基本设置 */}
      <Card title="防火墙" icon={<Shield size={15} />}>
        <TabBody q={fw}>
          <div className="divide-y divide-slate-100 dark:divide-white/5">
            <Field label="防火墙开关" inline>
              <Toggle
                checked={asBool(fw.data?.firewall_switch)}
                loading={busy === 'fw'}
                onChange={(v) =>
                  act('fw', '/api/router/firewall/switch', { firewall_switch: v ? '1' : '0' }, v ? '防火墙已开启' : '防火墙已关闭', { firewall_switch: v ? '1' : '0' })
                }
              />
            </Field>
            <Field label="安全等级" inline>
              <Select
                className="w-32"
                value={String(fw.data?.firewall_level ?? 'medium')}
                disabled={busy === 'level'}
                onChange={(e) =>
                  act('level', '/api/router/firewall/level', { firewall_level: e.target.value }, '安全等级已更新', { firewall_level: e.target.value })
                }
              >
                <option value="low">低</option>
                <option value="medium">中</option>
                <option value="high">高</option>
              </Select>
            </Field>
            <Field label="NAT" inline>
              <Toggle
                checked={asBool(fw.data?.nat_switch)}
                loading={busy === 'nat'}
                onChange={(v) =>
                  act('nat', '/api/router/firewall/nat', { nat_switch: v ? '1' : '0' }, v ? 'NAT 已开启' : 'NAT 已关闭', { nat_switch: v ? '1' : '0' })
                }
              />
            </Field>
            <Field label="UPnP" inline>
              <Toggle checked={asBool(upnp.data?.upnp_switch)} loading={busy === 'upnp'} onChange={toggleUpnp} />
            </Field>
          </div>

          <div className="mt-3 rounded-xl bg-slate-50 p-3 dark:bg-white/5">
            <Field label="DMZ 主机" inline>
              <Toggle checked={dmzOn} onChange={setDmzOn} />
            </Field>
            {dmzOn && (
              <div className="mt-2">
                <Field label="DMZ 主机 IP" hint="该主机将完全暴露在外网">
                  <Input value={dmzIp} onChange={(e) => setDmzIp(e.target.value)} className="font-mono" placeholder="192.168.0.x" />
                </Field>
              </div>
            )}
            <div className="mt-2 flex justify-end">
              <Button size="sm" variant="secondary" icon={<Save size={13} />} loading={savingDmz} onClick={saveDmz}>
                保存 DMZ
              </Button>
            </div>
          </div>
        </TabBody>
      </Card>

      {/* 端口转发 */}
      <Card
        title="端口转发"
        icon={<Shield size={15} />}
        extra={
          <div className="flex items-center gap-2">
            <Toggle checked={asBool(fw.data?.port_forward_switch)} loading={busy === 'pf'} onChange={togglePfSwitch} />
            <Button size="sm" icon={<Plus size={13} />} onClick={() => setAddOpen(true)}>
              添加
            </Button>
          </div>
        }
      >
        {pfRules.length === 0 ? (
          <EmptyState text="暂无端口转发规则" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400">
                  <th className="pb-2 font-medium">名称</th>
                  <th className="pb-2 font-medium">协议</th>
                  <th className="pb-2 font-medium">外部端口</th>
                  <th className="pb-2 font-medium">内部地址</th>
                  <th className="pb-2 font-medium">内部端口</th>
                  <th className="pb-2 font-medium">状态</th>
                  <th className="pb-2 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {pfRules.map((r) => (
                  <tr key={r.id}>
                    <td className="max-w-0 truncate py-2 pr-2 font-medium">{r.name || '--'}</td>
                    <td className="py-2 pr-2 uppercase">{r.protocol}</td>
                    <td className="tabular py-2 pr-2">{r.wan_port}</td>
                    <td className="tabular py-2 pr-2 font-mono text-xs">{r.lan_ip}</td>
                    <td className="tabular py-2 pr-2">{r.lan_port}</td>
                    <td className="py-2 pr-2">{r.enabled ? <Badge tone="green">启用</Badge> : <Badge tone="slate">停用</Badge>}</td>
                    <td className="py-2 text-right">
                      <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} loading={deleting === r.id} onClick={() => delRule(r)}>
                        删除
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* 过滤规则（只读） */}
      <Card title="MAC/IP/端口过滤规则" icon={<ListFilter size={15} />} extra={<Badge tone="slate">只读</Badge>}>
        {filterRules.length === 0 ? (
          <EmptyState text="暂无过滤规则" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400">
                  <th className="pb-2 font-medium">源 MAC</th>
                  <th className="pb-2 font-medium">源 IP</th>
                  <th className="pb-2 font-medium">源端口</th>
                  <th className="pb-2 font-medium">目的 IP</th>
                  <th className="pb-2 font-medium">目的端口</th>
                  <th className="pb-2 font-medium">协议</th>
                  <th className="pb-2 font-medium">状态</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {filterRules.map((r: any, i: number) => (
                  <tr key={String(r.id ?? i)}>
                    <td className="tabular max-w-0 truncate py-2 pr-2 font-mono text-xs">{r.src_mac || '--'}</td>
                    <td className="tabular py-2 pr-2 font-mono text-xs">{r.src_ip || '--'}</td>
                    <td className="tabular py-2 pr-2">{r.src_port || '--'}</td>
                    <td className="tabular py-2 pr-2 font-mono text-xs">{r.dest_ip || '--'}</td>
                    <td className="tabular py-2 pr-2">{r.dest_port || '--'}</td>
                    <td className="py-2 pr-2 uppercase">{r.protocol || '--'}</td>
                    <td className="py-2">{asBool(r.enabled) ? <Badge tone="green">启用</Badge> : <Badge tone="slate">停用</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* 添加端口转发 */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="添加端口转发规则"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAddOpen(false)}>
              取消
            </Button>
            <Button loading={adding} onClick={addRule}>
              添加
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="规则名称">
            <Input value={fName} onChange={(e) => setFName(e.target.value)} placeholder="如 Web 服务" />
          </Field>
          <Field label="协议">
            <Select value={fProto} onChange={(e) => setFProto(e.target.value)}>
              <option value="tcp">TCP</option>
              <option value="udp">UDP</option>
              <option value="tcp+udp">TCP + UDP</option>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="外部端口">
              <Input value={fWanPort} onChange={(e) => setFWanPort(e.target.value)} inputMode="numeric" placeholder="8080" />
            </Field>
            <Field label="内部端口">
              <Input value={fLanPort} onChange={(e) => setFLanPort(e.target.value)} inputMode="numeric" placeholder="80" />
            </Field>
          </div>
          <Field label="内部主机 IP">
            <Input value={fLanIp} onChange={(e) => setFLanIp(e.target.value)} className="font-mono" placeholder="192.168.0.x" />
          </Field>
        </div>
      </Modal>
    </div>
  )
}

/* ---------- VPN 透传 ---------- */

function VpnTab() {
  const q = useAsync(() => api.get('/api/router/vpn'), [])
  const [busy, setBusy] = useState<string | null>(null)

  const items = [
    { key: 'ipsec_passthrough', label: 'IPsec 透传', desc: '允许 IPsec VPN 连接穿透 NAT' },
    { key: 'pptp_passthrough', label: 'PPTP 透传', desc: '允许 PPTP VPN 连接穿透 NAT' },
    { key: 'l2tp_passthrough', label: 'L2TP 透传', desc: '允许 L2TP VPN 连接穿透 NAT' },
  ] as const

  const toggle = async (key: (typeof items)[number]['key'], v: boolean) => {
    const cur = {
      ipsec_passthrough: asBool(q.data?.ipsec_passthrough),
      pptp_passthrough: asBool(q.data?.pptp_passthrough),
      l2tp_passthrough: asBool(q.data?.l2tp_passthrough),
    }
    cur[key] = v
    setBusy(key)
    try {
      await api.put('/api/router/vpn', {
        ipsec_passthrough: cur.ipsec_passthrough ? '1' : '0',
        pptp_passthrough: cur.pptp_passthrough ? '1' : '0',
        l2tp_passthrough: cur.l2tp_passthrough ? '1' : '0',
      })
      if (q.data) q.setData({ ...q.data, [key]: v ? '1' : '0' })
      toast.success('VPN 透传设置已保存')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card title="VPN 透传" icon={<KeyRound size={15} />}>
      <TabBody q={q}>
        <div className="divide-y divide-slate-100 dark:divide-white/5">
          {items.map((it) => (
            <div key={it.key} className="flex items-center justify-between gap-3 py-2.5">
              <div>
                <div className="text-sm text-slate-700 dark:text-slate-200">{it.label}</div>
                <div className="text-xs text-slate-400 dark:text-slate-500">{it.desc}</div>
              </div>
              <Toggle checked={asBool(q.data?.[it.key])} loading={busy === it.key} onChange={(v) => toggle(it.key, v)} />
            </div>
          ))}
        </div>
      </TabBody>
    </Card>
  )
}

/* ---------- QoS ---------- */

function QosTab() {
  const q = useAsync(() => api.get('/api/router/qos'), [])
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [up, setUp] = useState('')
  const [down, setDown] = useState('')

  const hasUp = q.data != null && 'upstream_bandwidth' in q.data
  const hasDown = q.data != null && 'downstream_bandwidth' in q.data

  useEffect(() => {
    if (q.data) {
      setUp(String(q.data.upstream_bandwidth ?? ''))
      setDown(String(q.data.downstream_bandwidth ?? ''))
    }
  }, [q.data])

  const toggle = async (v: boolean) => {
    setBusy(true)
    try {
      await api.put('/api/router/qos', { qos_switch: v ? '1' : '0' })
      if (q.data) q.setData({ ...q.data, qos_switch: v ? '1' : '0' })
      toast.success(v ? 'QoS 已开启' : 'QoS 已关闭')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    setSaving(true)
    try {
      await api.put('/api/router/qos', {
        qos_switch: asBool(q.data?.qos_switch) ? '1' : '0',
        ...(hasUp ? { upstream_bandwidth: up } : {}),
        ...(hasDown ? { downstream_bandwidth: down } : {}),
      })
      toast.success('QoS 设置已保存')
      q.refresh()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card title="QoS 带宽控制" icon={<Gauge size={15} />}>
      <TabBody q={q}>
        <Field label="启用 QoS" inline>
          <Toggle checked={asBool(q.data?.qos_switch)} loading={busy} onChange={toggle} />
        </Field>
        {hasUp || hasDown ? (
          <div className="mt-3 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {hasUp && (
                <Field label="上行带宽" hint="单位以固件返回为准（通常为 Kbps）">
                  <Input value={up} onChange={(e) => setUp(e.target.value)} inputMode="numeric" />
                </Field>
              )}
              {hasDown && (
                <Field label="下行带宽" hint="单位以固件返回为准（通常为 Kbps）">
                  <Input value={down} onChange={(e) => setDown(e.target.value)} inputMode="numeric" />
                </Field>
              )}
            </div>
            <div className="flex justify-end">
              <Button icon={<Save size={14} />} loading={saving} onClick={save}>
                保存
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">当前固件仅提供 QoS 总开关，无带宽参数。</p>
        )}
      </TabBody>
    </Card>
  )
}

/* ---------- 域名过滤（遥测屏蔽） ---------- */

const TELEMETRY_DOMAINS = [
  'dclient.ztems.com',
  'dconfig.ztems.com',
  'iot.ztems.com',
  'mcs-cloud.ztems.com',
  'update.ztems.com',
]

function DomainFilterTab() {
  const q = useAsync(() => api.get('/api/router/domain-filter'), [])
  const [newDomain, setNewDomain] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const enabled = asBool(q.data?.enable)
  const mode = String(q.data?.mode ?? q.data?.filter_mode ?? 'blacklist')
  const rules: { id: string; domain: string; enabled: boolean }[] = (q.data?.rule_list ?? []).map(
    (r: any, i: number) => ({
      id: String(r.id ?? i),
      domain: String(r.domain ?? ''),
      enabled: asBool(r.enabled),
    }),
  )

  const toggleEnable = async (v: boolean) => {
    setBusy('enable')
    try {
      await api.put('/api/router/domain-filter', { enable: v ? '1' : '0' })
      if (q.data) q.setData({ ...q.data, enable: v ? '1' : '0' })
      toast.success(v ? '域名过滤已开启' : '域名过滤已关闭')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(null)
    }
  }

  const changeMode = async (v: string) => {
    setBusy('mode')
    try {
      await api.put('/api/router/domain-filter', { mode: v })
      if (q.data) q.setData({ ...q.data, mode: v })
      toast.success(v === 'blacklist' ? '已切换为黑名单模式' : '已切换为白名单模式')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(null)
    }
  }

  const addDomain = async (domain: string) => {
    const d = domain.trim().toLowerCase()
    if (!d) {
      toast.error('请输入域名')
      return false
    }
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) {
      toast.error('域名格式不正确')
      return false
    }
    if (rules.some((r) => r.domain === d)) {
      toast.error('该域名已存在')
      return false
    }
    setBusy('add')
    try {
      await api.put('/api/router/domain-filter', { action: 'add', domain: d, enabled: '1' })
      toast.success(`已添加 ${d}`)
      q.refresh()
      return true
    } catch (e: any) {
      toast.error(e.message)
      return false
    } finally {
      setBusy(null)
    }
  }

  const removeDomain = async (rule: { id: string; domain: string }) => {
    setBusy(rule.id)
    try {
      await api.put('/api/router/domain-filter', { action: 'delete', id: rule.id })
      toast.success(`已移除 ${rule.domain}`)
      q.refresh()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(null)
    }
  }

  const blockAllTelemetry = async () => {
    const existing = new Set(rules.map((r) => r.domain))
    const missing = TELEMETRY_DOMAINS.filter((d) => !existing.has(d))
    if (missing.length === 0) {
      toast.info('内置遥测域名已全部在列表中')
      return
    }
    setBusy('telemetry')
    let added = 0
    for (const d of missing) {
      try {
        await api.put('/api/router/domain-filter', { action: 'add', domain: d, enabled: '1' })
        added++
      } catch {
        /* 单个失败继续 */
      }
    }
    setBusy(null)
    if (added > 0) toast.success(`已屏蔽 ${added} 个遥测域名`)
    q.refresh()
  }

  return (
    <div className="space-y-4">
      <Card title="域名过滤（遥测屏蔽）" icon={<ListFilter size={15} />}>
        <TabBody q={q}>
          <div className="divide-y divide-slate-100 dark:divide-white/5">
            <Field label="启用域名过滤" inline>
              <Toggle checked={enabled} loading={busy === 'enable'} onChange={toggleEnable} />
            </Field>
            <Field label="过滤模式" inline>
              <Select className="w-36" value={mode} disabled={busy === 'mode'} onChange={(e) => changeMode(e.target.value)}>
                <option value="blacklist">黑名单</option>
                <option value="whitelist">白名单</option>
              </Select>
            </Field>
          </div>
          <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
            {mode === 'whitelist' ? '白名单模式：仅允许访问列表中的域名。' : '黑名单模式：拦截列表中的域名。'}
          </p>

          <div className="mt-3 flex items-center gap-2">
            <Input
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              placeholder="如 example.com"
              className="font-mono"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  addDomain(newDomain).then((ok) => ok && setNewDomain(''))
                }
              }}
            />
            <Button
              size="sm"
              variant="secondary"
              icon={<Plus size={13} />}
              loading={busy === 'add'}
              onClick={() => addDomain(newDomain).then((ok) => ok && setNewDomain(''))}
            >
              添加
            </Button>
          </div>

          {rules.length === 0 ? (
            <EmptyState text="暂无过滤域名" />
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              {rules.map((r) => (
                <span
                  key={r.id}
                  className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 py-1 pl-3 pr-1.5 font-mono text-xs text-slate-700 dark:bg-white/10 dark:text-slate-200"
                >
                  {r.domain}
                  <button
                    type="button"
                    title="删除"
                    disabled={busy === r.id}
                    onClick={() => removeDomain(r)}
                    className="rounded-full p-0.5 text-slate-400 transition-colors hover:bg-slate-300 hover:text-slate-600 disabled:opacity-50 dark:hover:bg-white/20 dark:hover:text-slate-200"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </TabBody>
      </Card>

      <Card
        title="内置遥测域名"
        icon={<Shield size={15} />}
        extra={
          <Button size="sm" variant="secondary" icon={<ShieldCheck size={13} />} loading={busy === 'telemetry'} onClick={blockAllTelemetry}>
            一键屏蔽全部
          </Button>
        }
      >
        <p className="mb-2 text-xs text-slate-400 dark:text-slate-500">
          以下为设备固件内置的 ZTE 遥测/云服务域名，屏蔽后可减少隐私数据上报。
        </p>
        <div className="flex flex-wrap gap-2">
          {TELEMETRY_DOMAINS.map((d) => {
            const blocked = rules.some((r) => r.domain === d)
            return (
              <button
                key={d}
                type="button"
                title={blocked ? '已在过滤列表中' : '点击添加到过滤列表'}
                onClick={() => !blocked && addDomain(d)}
                className={`rounded-full px-3 py-1 font-mono text-xs transition-colors ${
                  blocked
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
                    : 'bg-slate-100 text-slate-600 hover:bg-brand-100 hover:text-brand-700 dark:bg-white/10 dark:text-slate-300 dark:hover:bg-brand-500/15 dark:hover:text-brand-300'
                }`}
              >
                {blocked ? '✓ ' : '+ '}
                {d}
              </button>
            )
          })}
        </div>
      </Card>
    </div>
  )
}

/* ---------- 页面 ---------- */

export default function RouterPage() {
  const [tab, setTab] = useState('dns')
  return (
    <div className="space-y-4">
      <PageHeader title="路由设置" desc="DNS · LAN/DHCP · 防火墙 · VPN 透传 · QoS · 域名过滤" />
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'dns', label: 'DNS', icon: <Globe size={14} /> },
          { key: 'lan', label: 'LAN/DHCP', icon: <Network size={14} /> },
          { key: 'firewall', label: '防火墙', icon: <Shield size={14} /> },
          { key: 'vpn', label: 'VPN 透传', icon: <KeyRound size={14} /> },
          { key: 'qos', label: 'QoS', icon: <Gauge size={14} /> },
          { key: 'filter', label: '域名过滤', icon: <ListFilter size={14} /> },
        ]}
      />
      {tab === 'dns' && <DnsTab />}
      {tab === 'lan' && <LanTab />}
      {tab === 'firewall' && <FirewallTab />}
      {tab === 'vpn' && <VpnTab />}
      {tab === 'qos' && <QosTab />}
      {tab === 'filter' && <DomainFilterTab />}
    </div>
  )
}
