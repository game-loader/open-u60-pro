import React, { useMemo, useState } from 'react'

export type SeriesDef = {
  key: string
  label: string
  color: string
  /** 数值提取器 */
  get: (d: any) => number | null | undefined
  /** 单位格式化（tooltip / y 轴） */
  fmt?: (v: number) => string
}

/**
 * 轻量 SVG 折线图（面积填充 + hover tooltip）。
 * 专为实时信号/网速曲线设计，零依赖。
 */
export function LineChart({
  data,
  series,
  height = 160,
  yMin,
  yMax,
  unit = '',
}: {
  data: any[]
  series: SeriesDef[]
  height?: number
  yMin?: number
  yMax?: number
  unit?: string
}) {
  const W = 600
  const H = 240
  const PAD = { l: 44, r: 10, t: 10, b: 18 }
  const [hover, setHover] = useState<number | null>(null)

  const { paths, areas, min, max, ticks } = useMemo(() => {
    const all: number[] = []
    for (const d of data)
      for (const s of series) {
        const v = s.get(d)
        if (v != null && !isNaN(v)) all.push(v)
      }
    let min = yMin ?? (all.length ? Math.min(...all) : 0)
    let max = yMax ?? (all.length ? Math.max(...all) : 1)
    if (min === max) {
      min -= 1
      max += 1
    }
    // 给上下留 8% 余量
    if (yMin == null) min -= (max - min) * 0.08
    if (yMax == null) max += (max - min) * 0.08

    const iw = W - PAD.l - PAD.r
    const ih = H - PAD.t - PAD.b
    const x = (i: number) => PAD.l + (data.length <= 1 ? iw / 2 : (i / (data.length - 1)) * iw)
    const y = (v: number) => PAD.t + ih - ((v - min) / (max - min)) * ih

    const paths: Record<string, string> = {}
    const areas: Record<string, string> = {}
    for (const s of series) {
      let d = ''
      let started = false
      let lastX = 0
      data.forEach((pt, i) => {
        const v = s.get(pt)
        if (v == null || isNaN(v)) return
        d += `${started ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `
        started = true
        lastX = x(i)
      })
      paths[s.key] = d
      if (d && data.length > 1) {
        areas[s.key] = `${d}L${lastX.toFixed(1)},${(PAD.t + ih).toFixed(1)} L${x(0).toFixed(1)},${(PAD.t + ih).toFixed(1)} Z`
      }
    }
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => min + (max - min) * f)
    return { paths, areas, min, max, ticks }
  }, [data, series, yMin, yMax])

  const ih = H - PAD.t - PAD.b
  const yOf = (v: number) => PAD.t + ih - ((v - min) / (max - min)) * ih
  const fmt = series[0]?.fmt ?? ((v: number) => v.toFixed(Math.abs(max - min) < 10 ? 1 : 0))

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full select-none"
        style={{ height }}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
          const px = ((e.clientX - rect.left) / rect.width) * W
          const iw = W - PAD.l - PAD.r
          const i = Math.round(((px - PAD.l) / iw) * (data.length - 1))
          setHover(i >= 0 && i < data.length ? i : null)
        }}
        onMouseLeave={() => setHover(null)}
      >
        {/* 网格 + y 轴标签 */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={yOf(t)}
              y2={yOf(t)}
              stroke="currentColor"
              className="text-slate-200 dark:text-white/5"
              strokeWidth="1"
            />
            <text
              x={PAD.l - 6}
              y={yOf(t) + 3.5}
              textAnchor="end"
              className="fill-slate-400 dark:fill-slate-500"
              fontSize="10"
            >
              {fmt(t)}
            </text>
          </g>
        ))}
        {series.map((s) => (
          <React.Fragment key={s.key}>
            {areas[s.key] && (
              <path d={areas[s.key]} fill={s.color} opacity="0.10" />
            )}
            <path
              d={paths[s.key]}
              fill="none"
              stroke={s.color}
              strokeWidth="1.8"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </React.Fragment>
        ))}
        {hover != null && data[hover] && (
          <line
            x1={PAD.l + ((W - PAD.l - PAD.r) * hover) / Math.max(1, data.length - 1)}
            x2={PAD.l + ((W - PAD.l - PAD.r) * hover) / Math.max(1, data.length - 1)}
            y1={PAD.t}
            y2={H - PAD.b}
            stroke="currentColor"
            className="text-slate-400/50"
            strokeDasharray="3 3"
          />
        )}
      </svg>
      {/* 图例 + hover 数值 */}
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
            {s.label}
            <span className="tabular font-semibold text-slate-700 dark:text-slate-200">
              {hover != null && data[hover] && s.get(data[hover]) != null
                ? `${(s.fmt ?? fmt)(s.get(data[hover])!)}${unit}`
                : ''}
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}

/** 迷你面积图（卡片内嵌） */
export function Sparkline({
  data,
  get,
  color = '#06b6d4',
  height = 40,
}: {
  data: any[]
  get: (d: any) => number | null | undefined
  color?: string
  height?: number
}) {
  const W = 200
  const H = 60
  const vals = data.map(get).filter((v): v is number => v != null && !isNaN(v))
  if (vals.length < 2) return <div style={{ height }} className="w-full" />
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const span = max - min || 1
  const x = (i: number) => (i / (data.length - 1)) * W
  const y = (v: number) => H - 3 - ((v - min) / span) * (H - 6)
  let d = ''
  data.forEach((pt, i) => {
    const v = get(pt)
    if (v == null) return
    d += `${d ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `
  })
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      <path d={`${d}L${W},${H} L0,${H} Z`} fill={color} opacity="0.12" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" />
    </svg>
  )
}

/** 信号强度格（0-5） */
export function SignalBars({ level, className = '' }: { level: number; className?: string }) {
  return (
    <span className={`inline-flex items-end gap-[2px] ${className}`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={`w-[3px] rounded-sm ${i <= level ? 'bg-brand-500' : 'bg-slate-300 dark:bg-white/15'}`}
          style={{ height: `${4 + i * 2.5}px` }}
        />
      ))}
    </span>
  )
}
