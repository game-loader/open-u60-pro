import { useEffect, useRef, useState, useCallback } from 'react'

/** 一次性异步加载 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const fnRef = useRef(fn)
  fnRef.current = fn

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const d = await fnRef.current()
      setData(d)
      setError(null)
    } catch (e: any) {
      setError(e?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, error, loading, refresh, setData }
}

/**
 * 轮询。页面不可见时自动暂停。
 * immediate=true 时立即执行一次。
 */
export function usePoll(fn: () => Promise<void> | void, intervalMs: number, active = true) {
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    if (!active) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let running = false

    const tick = async () => {
      if (stopped || running || document.hidden) return
      running = true
      try {
        await fnRef.current()
      } catch {
        /* 轮询错误静默处理，由调用方自行 toast */
      } finally {
        running = false
      }
      if (!stopped && !document.hidden) {
        timer = setTimeout(() => {
          timer = null
          void tick()
        }, intervalMs)
      }
    }

    const start = () => {
      if (timer == null && !running && !document.hidden) void tick()
    }
    const stop = () => {
      if (timer != null) {
        clearTimeout(timer)
        timer = null
      }
    }
    const onVis = () => (document.hidden ? stop() : start())

    start()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      stopped = true
      stop()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [intervalMs, active])
}

/** 轮询 + 数据状态一体 */
export function usePolledData<T>(
  fn: () => Promise<T>,
  intervalMs: number,
  active = true,
) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const fnRef = useRef(fn)
  fnRef.current = fn

  const refresh = useCallback(async () => {
    try {
      const d = await fnRef.current()
      setData(d)
      setError(null)
    } catch (e: any) {
      setError(e?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  usePoll(refresh, intervalMs, active)

  return { data, error, loading, refresh, setData }
}

/** 滚动窗口：保存最近 N 个数据点（用于实时图表） */
export function useSeries<T>(maxPoints = 60) {
  const [series, setSeries] = useState<T[]>([])
  const push = useCallback(
    (point: T) => {
      setSeries((prev) => {
        const next = prev.length >= maxPoints ? prev.slice(prev.length - maxPoints + 1) : prev.slice()
        next.push(point)
        return next
      })
    },
    [maxPoints],
  )
  const clear = useCallback(() => setSeries([]), [])
  return { series, push, clear }
}
