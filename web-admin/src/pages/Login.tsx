import React, { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Wifi, Lock, Loader2 } from 'lucide-react'
import { login } from '../lib/api'

export default function Login() {
  const nav = useNavigate()
  const loc = useLocation() as any
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shake, setShake] = useState(0)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!password || loading) return
    setLoading(true)
    setError(null)
    try {
      await login(password)
      const to = loc?.state?.from?.pathname || '/'
      nav(to, { replace: true })
    } catch (e: any) {
      setError(e?.message || '登录失败')
      setShake((s) => s + 1)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-slate-100 p-4 dark:bg-surface-950">
      {/* 背景光斑 */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-brand-500/10 blur-3xl dark:bg-brand-500/15" />
        <div className="absolute bottom-0 right-0 h-72 w-72 rounded-full bg-sky-500/5 blur-3xl dark:bg-sky-500/10" />
      </div>

      <div key={shake} className={`relative w-full max-w-sm ${shake ? 'animate-shake' : ''}`}>
        <div className="rounded-3xl border border-slate-200/70 bg-white/90 p-8 shadow-xl backdrop-blur dark:border-white/10 dark:bg-surface-900/90">
          <div className="mb-8 flex flex-col items-center">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-700 text-white shadow-lg shadow-brand-600/30">
              <Wifi size={26} strokeWidth={2.2} />
            </div>
            <h1 className="text-lg font-bold text-slate-800 dark:text-white">U60 Pro 管理面板</h1>
            <p className="mt-1 text-xs text-slate-400">ZTE U60 Pro 随身 WiFi · zte-agent</p>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div className="relative">
              <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入管理密码"
                className="w-full rounded-xl border border-slate-300/80 bg-white py-2.5 pl-10 pr-3 text-sm outline-none transition-colors placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-white/10 dark:bg-white/5 dark:text-white"
              />
            </div>
            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-center text-xs text-red-600 dark:bg-red-500/10 dark:text-red-400">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={loading || !password}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand-600/25 transition-all hover:bg-brand-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
            >
              {loading && <Loader2 size={15} className="animate-spin" />}
              登 录
            </button>
          </form>

          <p className="mt-6 text-center text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
            使用 zte-agent 部署时设置的密码登录
            <br />
            （setup.sh / deploy.sh 中的 agent 密码）
          </p>
        </div>
      </div>
    </div>
  )
}
