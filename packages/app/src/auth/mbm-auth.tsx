import { createSimpleContext } from "@opencode-ai/ui/context"
import { createEffect, createSignal, onMount, type ParentProps, Show } from "solid-js"
import { usePlatform } from "@/context/platform"
import { fetchMbmCurrentUser, type MbmUser } from "./mbm-auth-api"
import { MbmLoginCard } from "./mbm-login-card"

const STORAGE_NAME = "opencode.mbm-auth.dat"
const STORAGE_KEY = "user"

function parseUser(raw: string | null) {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<MbmUser>
    if (!value.id || !value.accessToken || !value.username) return null
    return value as MbmUser
  } catch {
    return null
  }
}

export const { use: useMbmAuth, provider: MbmAuthProvider } = createSimpleContext({
  name: "MbmAuth",
  init: () => {
    const platform = usePlatform()
    const [user, setUser] = createSignal<MbmUser | null>(null)
    const [ready, setReady] = createSignal(false)

    const storage = () => platform.storage?.(STORAGE_NAME)

    const writeUser = (next: MbmUser | null) => {
      setUser(next)
      if (next) {
        void storage()?.setItem(STORAGE_KEY, JSON.stringify(next))
        return
      }
      void storage()?.removeItem(STORAGE_KEY)
    }

    onMount(() => {
      void Promise.resolve(storage()?.getItem(STORAGE_KEY) ?? null)
        .then(parseUser)
        .then(async (stored) => {
          if (!stored) return
          writeUser(await fetchMbmCurrentUser(stored))
        })
        .catch(() => writeUser(null))
        .finally(() => setReady(true))
    })

    return {
      user,
      ready,
      login: writeUser,
      logout: () => writeUser(null),
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
