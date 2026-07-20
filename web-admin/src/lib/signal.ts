/**
 * /api/network/signal（ubus zte_nwinfo_api nwinfo_get_netinfo 透传）解析。
 * 字段语义移植自 iOS SignalParser。
 */

export interface Carrier {
  label: string
  pci: string
  band: string
  earfcn: string
  bandwidth: string
  rsrp: number | null
  rsrq: number | null
  sinr: number | null
  rssi: number | null
}

export interface NRSignal {
  rsrp: number | null
  rsrq: number | null
  sinr: number | null
  rssi: number | null
  band: string
  pci: string
  cellID: string
  channel: string
  bandwidth: string
  ca: string
  scc: Carrier[]
}

export interface LTESignal {
  rsrp: number | null
  rsrq: number | null
  sinr: number | null
  rssi: number | null
  pci: string
  band: string
  earfcn: string
  bandwidth: string
  cellID: string
  caState: string
  scc: Carrier[]
}

export interface WCDMASignal {
  rscp: number | null
  ecio: number | null
}

export interface OperatorInfo {
  provider: string
  networkType: string
  signalBar: number
  roaming: boolean
}

export interface ParsedSignal {
  nr: NRSignal
  lte: LTESignal
  wcdma: WCDMASignal
  op: OperatorInfo
  /** 展示用网络类型：5G SA / 5G NSA / 4G+ / 4G ... */
  displayType: string
  /** 当前最佳 RSRP（用于评级） */
  bestRsrp: number | null
}

function parseDouble(v: unknown): number | null {
  let r: number | null = null
  if (typeof v === 'number') r = v
  else if (typeof v === 'string') {
    const t = v.trim()
    if (t === '' || t === '--' || t === 'N/A') return null
    const n = Number(t)
    r = isNaN(n) ? null : n
  }
  if (r != null && (r > 9000 || r < -9000)) return null
  return r
}

function str(v: unknown): string {
  if (v == null) return ''
  return String(v)
}

/** "PCI,Band,Index,EARFCN,BW;..." → 载波列表 */
function parseCaList(ca: string) {
  const out: { pci: string; band: string; earfcn: string; bandwidth: string }[] = []
  for (const entry of ca.replace(/;+$/, '').split(';')) {
    if (!entry) continue
    const p = entry.split(',')
    if (p.length >= 5) {
      out.push({ pci: p[0], band: p[1], earfcn: p[3], bandwidth: p[4] })
    }
  }
  return out
}

/** "RSRP,RSRQ,SINR,RSSI,...;..." → 信号列表 */
function parseCaSig(sig: string) {
  const out: { rsrp: number | null; rsrq: number | null; sinr: number | null; rssi: number | null }[] = []
  for (const entry of sig.replace(/;+$/, '').split(';')) {
    if (!entry) continue
    const p = entry.split(',')
    if (p.length >= 4) {
      out.push({
        rsrp: parseDouble(p[0]),
        rsrq: parseDouble(p[1]),
        sinr: parseDouble(p[2]),
        rssi: parseDouble(p[3]),
      })
    }
  }
  return out
}

function buildScc(
  ca: string,
  casig: string,
  pccPci: string,
  pccEarfcn: string,
  labelPrefix: string,
): { scc: Carrier[]; pccBandwidth: string } {
  const carriers = parseCaList(ca)
  const sigs = parseCaSig(casig)
  const rest: typeof carriers = []
  let pccBandwidth = ''
  let pccFound = false
  for (const c of carriers) {
    if (!pccFound && c.pci === pccPci && c.earfcn === pccEarfcn && pccPci !== '') {
      pccBandwidth = c.bandwidth
      pccFound = true
    } else {
      rest.push(c)
    }
  }
  const scc: Carrier[] = rest.map((c, i) => ({
    label: `${labelPrefix}${i}`,
    pci: c.pci,
    band: c.band,
    earfcn: c.earfcn,
    bandwidth: c.bandwidth,
    rsrp: sigs[i]?.rsrp ?? null,
    rsrq: sigs[i]?.rsrq ?? null,
    sinr: sigs[i]?.sinr ?? null,
    rssi: sigs[i]?.rssi ?? null,
  }))
  return { scc, pccBandwidth }
}

export function parseSignal(data: any): ParsedSignal {
  const d = data ?? {}

  const nrRaw = parseDouble(d.nr5g_rsrp)
  const nrScc = buildScc(str(d.nrca), str(d.nrcasig), str(d.nr5g_pci), str(d.nr5g_action_channel), '5G SCC')
  const nr: NRSignal = {
    rsrp: nrRaw === 0 ? null : nrRaw,
    rsrq: parseDouble(d.nr5g_rsrq),
    sinr: parseDouble(d.nr5g_snr),
    rssi: parseDouble(d.nr5g_rssi),
    band: str(d.nr5g_action_band),
    pci: str(d.nr5g_pci),
    cellID: str(d.nr5g_cell_id),
    channel: str(d.nr5g_action_channel),
    bandwidth: nrScc.pccBandwidth || str(d.nr5g_bandwidth),
    ca: str(d.nrca),
    scc: nrScc.scc,
  }

  const lteRaw = parseDouble(d.lte_rsrp)
  const lteScc = buildScc(str(d.lteca), str(d.ltecasig), str(d.lte_pci), str(d.wan_active_channel), 'SCC')
  const lte: LTESignal = {
    rsrp: lteRaw === 0 ? null : lteRaw,
    rsrq: parseDouble(d.lte_rsrq),
    sinr: parseDouble(d.lte_snr),
    rssi: parseDouble(d.lte_rssi),
    pci: str(d.lte_pci),
    band: str(d.wan_active_band),
    earfcn: str(d.wan_active_channel),
    bandwidth: lteScc.pccBandwidth,
    cellID: str(d.cell_id),
    caState: str(d.lteca_state),
    scc: lteScc.scc,
  }

  const rscpRaw = parseDouble(d.rscp)
  const wcdma: WCDMASignal = {
    rscp: rscpRaw === 0 ? null : rscpRaw,
    ecio: parseDouble(d.ecio),
  }

  const op: OperatorInfo = {
    provider: str(d.network_provider),
    networkType: str(d.network_type),
    signalBar: Number(str(d.signalbar)) || 0,
    roaming: str(d.simcard_roam) === '1',
  }

  // 展示网络类型（简化移植 iOS displayNetworkType）
  const nrConnected = nr.rsrp != null || nr.scc.some((c) => c.rsrp != null)
  const lteConnected = lte.rsrp != null || lte.scc.some((c) => c.rsrp != null)
  const raw = op.networkType.toUpperCase()
  let mode: 'sa' | 'nsa' | 'lte' | 'legacy' | 'unknown'
  if (raw === 'SA' || raw === '5G SA' || raw.includes('NR SA')) mode = 'sa'
  else if (raw.includes('NSA') || raw === 'ENDC' || raw === 'EN-DC') mode = 'nsa'
  else if (raw.includes('LTE') || raw === '4G' || raw === '4G+') mode = 'lte'
  else if (raw.includes('WCDMA') || raw.includes('UMTS') || raw.includes('GSM') || raw.includes('2G') || raw.includes('3G')) mode = 'legacy'
  else mode = 'unknown'

  let displayType: string
  if (nrConnected && (mode === 'lte' || mode === 'unknown')) displayType = '5G NSA'
  else if (!nrConnected && (mode === 'sa' || mode === 'nsa')) displayType = lteConnected && lte.scc.length > 0 ? '4G+' : '4G'
  else if (mode === 'sa') displayType = '5G SA'
  else if (mode === 'nsa') displayType = '5G NSA'
  else if (mode === 'lte') displayType = raw.includes('CA') || raw === '4G+' || raw.includes('LTE-A') || raw.includes('LTE+') ? '4G+' : '4G'
  else displayType = op.networkType || '--'

  const bestRsrp = nr.rsrp ?? lte.rsrp ?? wcdma.rscp

  return { nr, lte, wcdma, op, displayType, bestRsrp }
}

/** RSRP → 0-5 格 */
export function rsrpToBars(rsrp: number | null): number {
  if (rsrp == null) return 0
  if (rsrp >= -80) return 5
  if (rsrp >= -90) return 4
  if (rsrp >= -100) return 3
  if (rsrp >= -110) return 2
  if (rsrp >= -120) return 1
  return 0
}
