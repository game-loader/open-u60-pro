/** 格式化工具 */

export function fmtBytes(bytes: number | null | undefined, digits = 1): string {
  if (bytes == null || isNaN(bytes)) return '--'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 100 ? 0 : digits)} ${units[i]}`
}

/** bytes/s → 人性化速率 */
export function fmtSpeed(bytesPerSec: number | null | undefined): string {
  if (bytesPerSec == null || isNaN(bytesPerSec)) return '--'
  return `${fmtBytes(bytesPerSec)}/s`
}

/** bits/s → Mbps 等 */
export function fmtBitrate(bps: number | null | undefined): string {
  if (bps == null || isNaN(bps)) return '--'
  if (bps < 1000) return `${bps.toFixed(0)} bps`
  if (bps < 1_000_000) return `${(bps / 1000).toFixed(1)} Kbps`
  if (bps < 1_000_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`
  return `${(bps / 1_000_000_000).toFixed(2)} Gbps`
}

/** 秒 → "3天 4小时" / "12:34:56" */
export function fmtUptime(secs: number | null | undefined): string {
  if (secs == null || isNaN(secs)) return '--'
  const d = Math.floor(secs / 86400)
  const h = Math.floor((secs % 86400) / 3600)
  const m = Math.floor((secs % 3600) / 60)
  if (d > 0) return `${d} 天 ${h} 小时`
  if (h > 0) return `${h} 小时 ${m} 分`
  if (m > 0) return `${m} 分 ${Math.floor(secs % 60)} 秒`
  return `${Math.floor(secs)} 秒`
}

/** unix 秒 → "HH:MM:SS" 或 "MM-DD HH:MM" */
export function fmtTime(ts: number | null | undefined, withDate = false): string {
  if (!ts) return '--'
  const d = new Date(ts * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  const t = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  return withDate ? `${p(d.getMonth() + 1)}-${p(d.getDate())} ${t}` : t
}

/** 短信等时间戳（可能是秒或毫秒） */
export function fmtMsgTime(ts: number | string | null | undefined): string {
  if (ts == null) return '--'
  let n = typeof ts === 'string' ? Number(ts) : ts
  if (isNaN(n)) return String(ts)
  if (n > 1e12) n = Math.floor(n / 1000) // 毫秒 → 秒
  return fmtTime(n, true)
}

export function fmtPercent(v: number | null | undefined, digits = 0): string {
  if (v == null || isNaN(v)) return '--'
  return `${v.toFixed(digits)}%`
}

/** RSRP → 信号评级 */
export function rsrpLevel(rsrp: number | null | undefined): { label: string; color: string } {
  if (rsrp == null || isNaN(rsrp)) return { label: '未知', color: 'text-slate-400' }
  if (rsrp >= -80) return { label: '极好', color: 'text-emerald-400' }
  if (rsrp >= -90) return { label: '良好', color: 'text-green-400' }
  if (rsrp >= -100) return { label: '一般', color: 'text-yellow-400' }
  if (rsrp >= -110) return { label: '较差', color: 'text-orange-400' }
  return { label: '极差', color: 'text-red-400' }
}

/** 数字安全转换（API 经常返回字符串数字） */
export function num(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return isNaN(n) ? null : n
}

/** 字符串数字或数字 → number，兜底 0 */
export function num0(v: unknown): number {
  return num(v) ?? 0
}
