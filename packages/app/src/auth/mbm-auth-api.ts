const DEFAULT_API_BASE_URL = "https://afb-api.mbmzone.com/api"
export const MBM_API_BASE_URL = import.meta.env.VITE_MBM_API_BASE_URL || DEFAULT_API_BASE_URL
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

type TokenListItem = {
  id: number
  key?: string
}

type TokenPageData = {
  items?: TokenListItem[]
  total?: number
}

type TokenKeyData = {
  key?: string
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
  apiKey: string
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
    apiKey: "",
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
  const res = await readJson<{ is_new_user?: boolean }>(`${MBM_API_BASE_URL}/auth/sms/send`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phone, purpose: "sms_login" }),
  })
  if (!res?.success) throw new Error(res?.message || "发送验证码失败，请重试")
  return Boolean(res.data?.is_new_user)
}

export async function loginMbmBySms(input: { phone: string; code: string; affCode?: string }) {
  const res = await readJson<LoginData>(`${MBM_API_BASE_URL}/auth/sms/login`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      phone: input.phone,
      code: input.code,
      aff_code: input.affCode?.trim() || undefined,
    }),
  })
  if (!res?.success || !res.data) throw new Error(res?.message || "登录失败，请重试")
  const user = mapLoginUser(res.data)
  return {
    ...user,
    apiKey: await fetchMbmFirstApiKey(user),
  } satisfies MbmUser
}

export async function fetchMbmCurrentUser(user: MbmUser) {
  const res = await readJson<CurrentUserData>(`${MBM_API_BASE_URL}/user/self`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${user.accessToken}`,
      "New-API-User": user.id,
    },
  })
  if (!res?.success || !res.data) throw new Error(res?.message || "登录状态已过期，请重新登录")
  return {
    ...user,
    apiKey: user.apiKey || (await fetchMbmFirstApiKey(user)),
    username: res.data.username,
    displayName: res.data.display_name || res.data.username,
    phone: res.data.phone,
    role: res.data.role,
    status: res.data.status,
    group: res.data.group,
  } satisfies MbmUser
}

async function fetchMbmFirstApiKey(user: Pick<MbmUser, "id" | "accessToken">) {
  const list = await readJson<TokenPageData>(`${MBM_API_BASE_URL}/token/?page=1&page_size=1`, {
    method: "GET",
    headers: mbmUserHeaders(user),
  })
  if (!list?.success) throw new Error(list?.message || "获取 API Key 失败，请重试")

  const first = list.data?.items?.[0]
  if (!first?.id) throw new Error("当前账号没有可用 API Key，请先在 MBM 后台创建")

  const detail = await readJson<TokenKeyData>(`${MBM_API_BASE_URL}/token/${first.id}/key`, {
    method: "POST",
    headers: mbmUserHeaders(user),
  })
  const apiKey = detail?.data?.key?.trim()
  if (!detail?.success || !apiKey) throw new Error(detail?.message || "获取 API Key 失败，请重试")
  return apiKey
}

function mbmUserHeaders(user: Pick<MbmUser, "id" | "accessToken">) {
  return {
    Authorization: `Bearer ${user.accessToken}`,
    "New-API-User": user.id,
  }
}
