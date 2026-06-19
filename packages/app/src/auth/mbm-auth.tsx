import { createSimpleContext } from "@opencode-ai/ui/context"
import { createEffect, createSignal, onCleanup, onMount, type ParentProps, Show } from "solid-js"
import { useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { usePlatform } from "@/context/platform"
import { authTokenFromCredentials } from "@/utils/server"
import { MBM_API_BASE_URL, type MbmUser } from "./mbm-auth-api"
import { MbmLoginCard } from "./mbm-login-card"

const SYNC_INTERVAL_MS = 30 * 60 * 1000

type MbmSessionUser = Pick<MbmUser, "id" | "username" | "displayName" | "phone">

type MopcSession = {
  api_base_url: string
  user: {
    id: number
    username: string
    displayName?: string
  }
  updated_at: number
}

type MopcAccount = {
  remaining_tokens?: number
  quota?: number
  used_quota?: number
  request_count?: number
  group?: string
  active_subscription_count: number
  billing_preference?: string
  updated_at: number
}

export type MopcSubscription = {
  id: number
  plan_id: number
  title: string
  subtitle?: string
  status: string
  amount_total: number
  amount_used: number
  end_time: number
  next_reset_time?: number
}

export const { use: useMbmAuth, provider: MbmAuthProvider } = createSimpleContext({
  name: "MbmAuth",
  init: () => {
    const platform = usePlatform()
    const server = useServer()
    const serverSDK = useServerSDK()
    const [user, setUser] = createSignal<MbmSessionUser | null>(null)
    const [account, setAccount] = createSignal<MopcAccount | null>(null)
    const [ready, setReady] = createSignal(false)

    const mopcFetch = async <T,>(path: string, init?: RequestInit) => {
      const current = server.current
      if (!current) throw new Error("No opencode server is available")
      const auth = current.http.password
        ? {
            Authorization: `Basic ${authTokenFromCredentials({
              username: current.http.username,
              password: current.http.password,
            })}`,
          }
        : undefined
      const res = await (platform.fetch ?? fetch)(`${serverSDK().url}${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...auth,
          ...(init?.headers ?? {}),
        },
      })
      if (!res.ok) throw new Error(`MOPC session request failed (${res.status})`)
      if (res.status === 204) return null
      return (await res.json().catch(() => null)) as T | null
    }

    const refreshAccount = async () => {
      if (!user()) return
      setAccount(await mopcFetch<MopcAccount>("/api/mopc/account").catch(() => null))
    }

    const fetchSubscriptions = async () => {
      if (!user()) return [] as MopcSubscription[]
      return (await mopcFetch<MopcSubscription[]>("/api/mopc/subscriptions").catch(() => [])) ?? []
    }

    const saveMopcSession = async (next: MbmUser) => {
      if (!next.apiKey) throw new Error("当前账号没有可用 API Key，请先在 MBM 后台创建")
      const session = await mopcFetch<MopcSession>("/api/mopc/session", {
        method: "PUT",
        body: JSON.stringify({
          api_base_url: MBM_API_BASE_URL,
          user: {
            id: Number(next.id),
            username: next.username,
            displayName: next.displayName,
          },
          access_token: next.accessToken,
          api_key: next.apiKey,
        }),
      })
      setUser({
        id: String(session?.user.id ?? next.id),
        username: session?.user.username ?? next.username,
        displayName: session?.user.displayName ?? next.displayName,
        phone: next.phone,
      })
      await refreshAccount()
      await serverSDK().client.global.dispose()
    }

    const loadMopcSession = async () => {
      const session = await mopcFetch<MopcSession>("/api/mopc/session")
      setUser(
        session
          ? {
              id: String(session.user.id),
              username: session.user.username,
              displayName: session.user.displayName ?? session.user.username,
            }
          : null,
      )
      if (session) {
        await refreshAccount()
        void syncMopcSkills().catch(() => undefined)
      } else setAccount(null)
    }

    const syncMopcSkills = async () => {
      if (!user()) return
      await mopcFetch("/api/mopc/session/sync", { method: "POST" })
      await serverSDK().client.global.dispose()
    }

    const clearMopcSession = async () => {
      await mopcFetch("/api/mopc/session", { method: "DELETE" }).catch(() => undefined)
      setUser(null)
      setAccount(null)
      await serverSDK()
        .client.global.dispose()
        .catch(() => undefined)
    }

    const login = async (next: MbmUser) => {
      await saveMopcSession(next)
    }

    const logout = () => {
      void clearMopcSession()
    }

    onMount(() => {
      void loadMopcSession()
        .catch(() => setUser(null))
        .finally(() => setReady(true))

      const timer = window.setInterval(() => {
        void syncMopcSkills().catch(() => undefined)
      }, SYNC_INTERVAL_MS)
      onCleanup(() => window.clearInterval(timer))
    })

    return {
      user,
      account,
      ready,
      login,
      logout,
      refreshAccount,
      fetchSubscriptions,
    }
  },
})

export function MbmAuthGate(props: ParentProps) {
  const auth = useMbmAuth()

  createEffect(() => {
    document.body.classList.toggle("mbm-auth-open", auth.ready() && !auth.user())
  })

  return (
    <Show when={auth.ready() && auth.user()} fallback={<MbmLoginCard onLogin={auth.login} loading={!auth.ready()} />}>
      {props.children}
    </Show>
  )
}
