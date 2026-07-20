/**
 * zte-agent REST API 客户端。
 *
 * 统一响应封装：成功 {"ok": true, "data": ...}，失败 {"ok": false, "error": "..."}。
 * 认证：POST /api/auth/login 获取 Bearer token（1 小时有效期，服务重启失效）。
 */

const TOKEN_KEY = 'u60_token'

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

/** 401 时触发，App 监听后跳转登录页 */
type UnauthorizedListener = () => void
let onUnauthorized: UnauthorizedListener | null = null
export function setUnauthorizedHandler(fn: UnauthorizedListener) {
  onUnauthorized = fn
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  let res: Response
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError('无法连接设备，请检查网络', 0)
  }

  let json: any = null
  try {
    json = await res.json()
  } catch {
    // 非 JSON 响应
  }

  if (res.status === 401) {
    clearToken()
    onUnauthorized?.()
    throw new ApiError(json?.error || '登录已过期，请重新登录', 401)
  }
  if (!res.ok || json?.ok === false) {
    throw new ApiError(json?.error || `请求失败 (${res.status})`, res.status)
  }
  return (json?.data ?? json) as T
}

export const api = {
  get: <T = any>(path: string) => request<T>('GET', path),
  post: <T = any>(path: string, body?: unknown) => request<T>('POST', path ?? '', body),
  put: <T = any>(path: string, body?: unknown) => request<T>('PUT', path, body),
  delete: <T = any>(path: string, body?: unknown) => request<T>('DELETE', path, body),
}

/** 登录，成功返回 token（已自动持久化） */
export async function login(password: string): Promise<string> {
  const data = await request<{ token: string }>('POST', '/api/auth/login', { password })
  setToken(data.token)
  return data.token
}

/** 并发拉取多个端点，单个失败不影响其他（失败项为 null） */
export async function fetchAll<T extends Record<string, () => Promise<any>>>(
  tasks: T,
): Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> | null }> {
  const keys = Object.keys(tasks) as (keyof T)[]
  const results = await Promise.allSettled(keys.map((k) => tasks[k]()))
  const out: any = {}
  keys.forEach((k, i) => {
    const r = results[i]
    out[k] = r.status === 'fulfilled' ? r.value : null
  })
  return out
}
