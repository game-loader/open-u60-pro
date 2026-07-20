const THEME_KEY = 'u60_theme'

export type Theme = 'dark' | 'light'

export function getTheme(): Theme {
  const saved = localStorage.getItem(THEME_KEY)
  if (saved === 'light' || saved === 'dark') return saved
  return 'dark' // 默认深色（mihomo 面板风格）
}

export function setTheme(theme: Theme) {
  localStorage.setItem(THEME_KEY, theme)
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.classList.toggle('light', theme === 'light')
}

export function initTheme() {
  setTheme(getTheme())
}
