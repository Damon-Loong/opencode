const DEFAULT_API_BASE_URL = "https://afb-api.mbmzone.com/api"
const BASE_URL = import.meta.env.VITE_MBM_API_BASE_URL || DEFAULT_API_BASE_URL
const JSON_HEADERS = {
  "Content-Type": "application/json",
}

type ApiResponse<T> = {
  success: boolean
  message?: string
  data?: T
}

type LoginData = {
  id: number
  username: string
  display_name: string
  phone?: string
  role: number
  status: number
  group: string
  access_token: string
}

type CurrentUserData = {
  id: number
  username: string
  display_name: string
  phone?: string
  role: number
  status: number
  group: string
}

export type MbmUser = {
  id: string
  username: string
  displayName: string
  phone?: string
  role: number
  status: number
  group: string
  accessToken: string
}

function mapLoginUser(data: LoginData): MbmUser {
  return {
    id: String(data.id),
    username: data.username,
    displayName: data.display_name || data.username,
    phone: data.phone,
    role: data.role,
    status: data.status,
    group: data.group,
    accessToken: data.access_token,
  }
}

async function readJson<T>(input: string, init?: RequestInit) {
  const res = await fetch(input, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  })

  const body = (await res.json().catch(() => null)) as ApiResponse<T> | null
  if (!res.ok) throw new Error(body?.message || `请求失败（${res.status}）`)
  return body
}

export async function sendMbmSmsLoginCode(phone: string) {
  const res = await readJson<{ is_new_user?: boolean }>(`${BASE_URL}/auth/sms/send`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phone, purpose: "sms_login" }),
  })
  if (!res?.success) throw new Error(res?.message || "发送验证码失败，请重试")
  return Boolean(res.data?.is_new_user)
}

export async function loginMbmBySms(input: { phone: string; code: string; affCode?: string }) {
  const res = await readJson<LoginData>(`${BASE_URL}/auth/sms/login`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      phone: input.phone,
      code: input.code,
      aff_code: input.affCode?.trim() || undefined,
    }),
  })
  if (!res?.success || !res.data) throw new Error(res?.message || "登录失败，请重试")
  return mapLoginUser(res.data)
}

export async function fetchMbmCurrentUser(user: MbmUser) {
  const res = await readJson<CurrentUserData>(`${BASE_URL}/user/self`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${user.accessToken}`,
      "New-API-User": user.id,
    },
  })
  if (!res?.success || !res.data) throw new Error(res?.message || "登录状态已过期，请重新登录")
  return {
    ...user,
    username: res.data.username,
    displayName: res.data.display_name || res.data.username,
    phone: res.data.phone,
    role: res.data.role,
    status: res.data.status,
    group: res.data.group,
  } satisfies MbmUser
}
