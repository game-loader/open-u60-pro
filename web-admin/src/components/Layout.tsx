import React, { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Radio,
  MessageSquare,
  Phone,
  Signal,
  Antenna,
  Wifi,
  Router as RouterIcon,
  CreditCard,
  Settings2,
  Wrench,
  LogOut,
  Menu,
  X,
  Sun,
  Moon,
  Waypoints,
} from 'lucide-react'
import { clearToken, setUnauthorizedHandler } from '../lib/api'
import { setTheme, getTheme } from '../lib/theme'

const NAV = [
  { to: '/', label: '概览', icon: <LayoutDashboard size={17} />, end: true },
  { to: '/signal', label: '信号监测', icon: <Radio size={17} /> },
  { to: '/sms', label: '短信', icon: <MessageSquare size={17} /> },
  { to: '/call', label: '电话', icon: <Phone size={17} /> },
  { to: '/network', label: '移动网络', icon: <Signal size={17} /> },
  { to: '/cells', label: '频段小区', icon: <Antenna size={17} /> },
  { to: '/wifi', label: 'WiFi', icon: <Wifi size={17} /> },
  { to: '/router', label: '路由设置', icon: <RouterIcon size={17} /> },
  { to: '/sim', label: 'SIM 卡', icon: <CreditCard size={17} /> },
  { to: '/device', label: '设备管理', icon: <Settings2 size={17} /> },
  { to: '/tools', label: '工具箱', icon: <Wrench size={17} /> },
  { to: '/mihomo', label: 'Mihomo', icon: <Waypoints size={17} /> },
]

export default function Layout() {
  const nav = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [dark, setDark] = useState(getTheme() === 'dark')

  useEffect(() => {
    setUnauthorizedHandler(() => nav('/login', { replace: true }))
  }, [nav])

  const logout = () => {
    clearToken()
    nav('/login', { replace: true })
  }

  const toggleTheme = () => {
    const next = dark ? 'light' : 'dark'
    setTheme(next)
    setDark(!dark)
  }

  const sidebar = (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 pb-5 pt-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-700 text-white shadow-lg shadow-brand-600/20">
          <Wifi size={18} strokeWidth={2.2} />
        </div>
        <div>
          <div className="text-sm font-bold tracking-wide text-slate-800 dark:text-white">
            U60 Pro
          </div>
          <div className="text-[11px] text-slate-400 dark:text-slate-500">管理面板</div>
        </div>
      </div>
      {/* 导航 */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end as any}
            onClick={() => setMenuOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium transition-colors ${
                isActive
                  ? 'bg-brand-600/10 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300'
                  : 'text-slate-500 hover:bg-slate-200/60 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-slate-200'
              }`
            }
          >
            {item.icon}
            {item.label}
          </NavLink>
        ))}
      </nav>
      {/* 底部操作 */}
      <div className="space-y-0.5 border-t border-slate-200/70 p-3 dark:border-white/5">
        <button
          onClick={toggleTheme}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium text-slate-500 hover:bg-slate-200/60 dark:text-slate-400 dark:hover:bg-white/5"
        >
          {dark ? <Sun size={17} /> : <Moon size={17} />}
          {dark ? '浅色模式' : '深色模式'}
        </button>
        <button
          onClick={logout}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium text-slate-500 hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-500/10 dark:hover:text-red-400"
        >
          <LogOut size={17} />
          退出登录
        </button>
      </div>
    </div>
  )

  return (
    <div className="flex h-full">
      {/* 桌面端侧边栏 */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-52 shrink-0 border-r border-slate-200/70 bg-white/80 backdrop-blur lg:block dark:border-white/5 dark:bg-surface-900/80">
        {sidebar}
      </aside>
      {/* 移动端抽屉 */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMenuOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-60 border-r border-slate-200 bg-white dark:border-white/10 dark:bg-surface-900">
            {sidebar}
          </aside>
        </div>
      )}

      {/* 主区域 */}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-52">
        {/* 顶栏 */}
        <header className="sticky top-0 z-20 flex h-13 items-center gap-2 border-b border-slate-200/70 bg-white/80 px-4 py-2.5 backdrop-blur lg:px-6 dark:border-white/5 dark:bg-surface-950/80">
          <button
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-200/60 lg:hidden dark:text-slate-400 dark:hover:bg-white/10"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            ZTE U60 Pro 随身 WiFi
          </div>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden items-center gap-1.5 text-xs text-slate-400 sm:flex">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              已连接
            </span>
          </div>
        </header>
        {/* 内容 */}
        <main className="min-w-0 flex-1 p-4 lg:p-6">
          <div className="mx-auto max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
