import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Loader2, AlertCircle, CheckCircle2, Info, AlertTriangle } from 'lucide-react'

/* ---------- 卡片 ---------- */

export function Card({
  title,
  icon,
  extra,
  children,
  className = '',
  pad = true,
}: {
  title?: React.ReactNode
  icon?: React.ReactNode
  extra?: React.ReactNode
  children: React.ReactNode
  className?: string
  pad?: boolean
}) {
  return (
    <section
      className={`rounded-2xl border border-slate-200/70 bg-white shadow-sm
        dark:border-white/5 dark:bg-surface-900 ${className}`}
    >
      {(title || extra) && (
        <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 dark:border-white/5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            {icon && <span className="text-brand-500">{icon}</span>}
            {title}
          </h3>
          {extra}
        </header>
      )}
      <div className={pad ? 'p-4' : ''}>{children}</div>
    </section>
  )
}

/* ---------- 统计块 ---------- */

export function Stat({
  label,
  value,
  sub,
  icon,
  tone = 'default',
}: {
  label: React.ReactNode
  value: React.ReactNode
  sub?: React.ReactNode
  icon?: React.ReactNode
  tone?: 'default' | 'brand' | 'green' | 'yellow' | 'red'
}) {
  const tones = {
    default: 'text-slate-900 dark:text-white',
    brand: 'text-brand-500',
    green: 'text-emerald-500',
    yellow: 'text-amber-500',
    red: 'text-red-500',
  }
  return (
    <div className="flex min-w-0 items-center gap-3">
      {icon && (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-slate-300">
          {icon}
        </div>
      )}
      <div className="min-w-0">
        <div className="truncate text-xs text-slate-500 dark:text-slate-400">{label}</div>
        <div className={`tabular truncate text-lg font-semibold leading-tight ${tones[tone]}`}>
          {value}
        </div>
        {sub && <div className="truncate text-xs text-slate-400 dark:text-slate-500">{sub}</div>}
      </div>
    </div>
  )
}

/* ---------- 键值行 ---------- */

export function KV({ k, v, mono = false }: { k: React.ReactNode; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <dt className="shrink-0 text-slate-500 dark:text-slate-400">{k}</dt>
      <dd
        className={`tabular min-w-0 break-all text-right font-medium text-slate-800 dark:text-slate-200 ${
          mono ? 'font-mono text-[13px]' : ''
        }`}
      >
        {v ?? '--'}
      </dd>
    </div>
  )
}

/* ---------- 徽章 ---------- */

export function Badge({
  children,
  tone = 'slate',
}: {
  children: React.ReactNode
  tone?: 'slate' | 'green' | 'red' | 'yellow' | 'brand' | 'blue' | 'purple'
}) {
  const tones: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300',
    green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
    red: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400',
    yellow: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
    brand: 'bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300',
    blue: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400',
    purple: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-400',
  }
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  )
}

/* ---------- 按钮 ---------- */

export function Button({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  icon,
  className = '',
  type = 'button',
  title,
}: {
  children: React.ReactNode
  onClick?: (e: React.MouseEvent) => void
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'success'
  size?: 'sm' | 'md'
  loading?: boolean
  disabled?: boolean
  icon?: React.ReactNode
  className?: string
  type?: 'button' | 'submit'
  title?: string
}) {
  const variants: Record<string, string> = {
    primary:
      'bg-brand-600 text-white hover:bg-brand-500 active:bg-brand-700 disabled:bg-brand-600/40 shadow-sm',
    secondary:
      'bg-slate-200/80 text-slate-700 hover:bg-slate-300/80 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15 disabled:opacity-50',
    danger:
      'bg-red-600/90 text-white hover:bg-red-500 disabled:bg-red-600/40 shadow-sm',
    success:
      'bg-emerald-600/90 text-white hover:bg-emerald-500 disabled:bg-emerald-600/40 shadow-sm',
    ghost:
      'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-white/10 disabled:opacity-50',
  }
  const sizes = { sm: 'px-2.5 py-1 text-xs gap-1', md: 'px-3.5 py-1.5 text-sm gap-1.5' }
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled || loading}
      className={`inline-flex select-none items-center justify-center rounded-lg font-medium transition-colors
        disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${className}`}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : icon}
      {children}
    </button>
  )
}

/* ---------- 表单 ---------- */

export function Field({
  label,
  hint,
  children,
  inline = false,
}: {
  label: React.ReactNode
  hint?: React.ReactNode
  children: React.ReactNode
  inline?: boolean
}) {
  if (inline) {
    return (
      <label className="flex items-center justify-between gap-3 py-1.5">
        <span className="text-sm text-slate-600 dark:text-slate-300">{label}</span>
        <span className="flex items-center gap-2">{children}</span>
      </label>
    )
  }
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">{label}</label>
      {children}
      {hint && <p className="text-xs text-slate-400 dark:text-slate-500">{hint}</p>}
    </div>
  )
}

export const inputCls =
  'w-full rounded-lg border border-slate-300/80 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:placeholder:text-slate-500'

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className = '', ...rest } = props
  return <input {...rest} className={`${inputCls} ${className}`} />
}

export function Select({
  children,
  className = '',
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={`${inputCls} appearance-none pr-8 ${className}`}>
      {children}
    </select>
  )
}

/* ---------- 开关 ---------- */

export function Toggle({
  checked,
  onChange,
  disabled = false,
  loading = false,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  loading?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled || loading}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50
        ${checked ? 'bg-brand-500' : 'bg-slate-300 dark:bg-white/15'}`}
    >
      <span
        className={`absolute top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-white shadow transition-all ${
          checked ? 'left-[22px]' : 'left-0.5'
        }`}
      >
        {loading && <Loader2 size={12} className="animate-spin text-slate-500" />}
      </span>
    </button>
  )
}

/* ---------- 进度条 ---------- */

export function Progress({
  value,
  tone = 'brand',
  className = '',
}: {
  value: number // 0-100
  tone?: 'brand' | 'green' | 'yellow' | 'red' | 'auto'
  className?: string
}) {
  let color = 'bg-brand-500'
  const t = tone === 'auto' ? (value >= 90 ? 'red' : value >= 70 ? 'yellow' : 'brand') : tone
  if (t === 'green') color = 'bg-emerald-500'
  if (t === 'yellow') color = 'bg-amber-500'
  if (t === 'red') color = 'bg-red-500'
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-white/10 ${className}`}>
      <div
        className={`h-full rounded-full transition-all ${color}`}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  )
}

/* ---------- Tabs ---------- */

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: string; label: React.ReactNode; icon?: React.ReactNode }[]
  active: string
  onChange: (key: string) => void
}) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-xl bg-slate-200/60 p-1 dark:bg-white/5">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            active === t.key
              ? 'bg-white text-slate-800 shadow-sm dark:bg-surface-800 dark:text-white'
              : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  )
}

/* ---------- 模态框 ---------- */

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide = false,
}: {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className={`animate-fade-in max-h-[90vh] w-full overflow-y-auto rounded-t-2xl border border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-surface-900 sm:rounded-2xl ${
          wide ? 'sm:max-w-2xl' : 'sm:max-w-md'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white px-4 py-3 dark:border-white/5 dark:bg-surface-900">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/10"
          >
            <X size={16} />
          </button>
        </header>
        <div className="p-4">{children}</div>
        {footer && (
          <footer className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3 dark:border-white/5">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  )
}

export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  message,
  danger = false,
  loading = false,
  confirmText = '确认',
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: React.ReactNode
  danger?: boolean
  loading?: boolean
  confirmText?: string
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmText}
          </Button>
        </>
      }
    >
      <div className="flex items-start gap-3 text-sm text-slate-600 dark:text-slate-300">
        <AlertTriangle className={`mt-0.5 shrink-0 ${danger ? 'text-red-500' : 'text-amber-500'}`} size={18} />
        <div>{message}</div>
      </div>
    </Modal>
  )
}

/* ---------- 状态展示 ---------- */

export function Spinner({ text = '加载中…' }: { text?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
      <Loader2 size={16} className="animate-spin" />
      {text}
    </div>
  )
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <AlertCircle size={20} className="text-red-400" />
      <p className="text-sm text-slate-500 dark:text-slate-400">{error}</p>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          重试
        </Button>
      )}
    </div>
  )
}

export function EmptyState({ text = '暂无数据', icon }: { text?: string; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-slate-400 dark:text-slate-500">
      {icon}
      <p className="text-sm">{text}</p>
    </div>
  )
}

/* ---------- 页面头 ---------- */

export function PageHeader({
  title,
  desc,
  extra,
}: {
  title: React.ReactNode
  desc?: React.ReactNode
  extra?: React.ReactNode
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h1 className="text-lg font-bold text-slate-800 dark:text-white">{title}</h1>
        {desc && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{desc}</p>}
      </div>
      {extra && <div className="flex items-center gap-2">{extra}</div>}
    </div>
  )
}

/* ---------- Toast ---------- */

type ToastItem = { id: number; msg: string; tone: 'success' | 'error' | 'info' }
type ToastFn = (msg: string, tone?: ToastItem['tone']) => void
let toastFn: ToastFn | null = null
export function toast(msg: string, tone: ToastItem['tone'] = 'info') {
  toastFn?.(msg, tone)
}
toast.success = (m: string) => toast(m, 'success')
toast.error = (m: string) => toast(m, 'error')
toast.info = (m: string) => toast(m, 'info')

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([])
  useEffect(() => {
    let id = 0
    toastFn = (msg, tone = 'info') => {
      const item = { id: ++id, msg, tone }
      setItems((prev) => [...prev.slice(-4), item])
      setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== item.id)), 3500)
    }
    return () => {
      toastFn = null
    }
  }, [])

  const icons = {
    success: <CheckCircle2 size={15} className="text-emerald-400" />,
    error: <AlertCircle size={15} className="text-red-400" />,
    info: <Info size={15} className="text-brand-400" />,
  }
  return createPortal(
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex w-full max-w-sm -translate-x-1/2 flex-col items-center gap-2 px-4">
      {items.map((t) => (
        <div
          key={t.id}
          className="animate-fade-in pointer-events-auto flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm shadow-lg dark:border-white/10 dark:bg-surface-800 dark:text-slate-100"
        >
          {icons[t.tone]}
          <span className="break-all">{t.msg}</span>
        </div>
      ))}
    </div>,
    document.body,
  )
}
