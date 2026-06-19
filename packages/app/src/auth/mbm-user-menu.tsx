import { createMemo, createSignal, For, Show } from "solid-js"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { type MopcSubscription, useMbmAuth } from "./mbm-auth"
import "./mbm-user-menu.css"

export function MbmUserMenu() {
  const auth = useMbmAuth()
  const [loggingOut, setLoggingOut] = createSignal(false)
  const [showSubscriptions, setShowSubscriptions] = createSignal(false)
  const [subscriptionLoading, setSubscriptionLoading] = createSignal(false)
  const [subscriptions, setSubscriptions] = createSignal<MopcSubscription[]>([])
  const label = createMemo(() => auth.user()?.displayName || auth.user()?.username || auth.user()?.phone || "MBM")
  const initial = createMemo(() => label().trim().charAt(0).toUpperCase() || "M")
  const remainingTokens = createMemo(() => auth.account()?.remaining_tokens ?? auth.account()?.quota)
  const tokenLabel = createMemo(() =>
    remainingTokens() === undefined ? "--" : new Intl.NumberFormat().format(remainingTokens() ?? 0),
  )
  const subscriptionCount = createMemo(() => auth.account()?.active_subscription_count ?? 0)

  const logout = () => {
    setLoggingOut(true)
    auth.logout()
  }

  const openSubscriptions = async () => {
    setShowSubscriptions(true)
    setSubscriptionLoading(true)
    setSubscriptions(await auth.fetchSubscriptions())
    setSubscriptionLoading(false)
  }

  return (
    <Show when={auth.user()}>
      {(user) => (
        <MenuV2
          gutter={6}
          modal={false}
          placement="bottom-end"
          onOpenChange={(open) => {
            if (!open) setShowSubscriptions(false)
          }}
        >
          <MenuV2.Trigger
            class="mbm-user-menu-trigger"
            aria-label="用户菜单"
            onClick={() => void auth.refreshAccount()}
          >
            <span class="mbm-user-menu-avatar" aria-hidden="true">
              {initial()}
            </span>
          </MenuV2.Trigger>
          <MenuV2.Portal>
            <MenuV2.Content class="mbm-user-menu-content">
              <Show
                when={showSubscriptions()}
                fallback={
                  <>
                    <div class="mbm-user-menu-profile">
                      <span class="mbm-user-menu-profile-avatar" aria-hidden="true">
                        {initial()}
                      </span>
                      <span class="mbm-user-menu-profile-copy">
                        <span class="mbm-user-menu-name">{label()}</span>
                        <Show when={user().phone}>{(phone) => <span class="mbm-user-menu-meta">{phone()}</span>}</Show>
                      </span>
                    </div>
                    <div class="mbm-user-menu-token">
                      <span>剩余 Token</span>
                      <strong>{tokenLabel()}</strong>
                    </div>
                    <button class="mbm-user-menu-row" type="button" onClick={() => void openSubscriptions()}>
                      <span>生效套餐</span>
                      <strong>{subscriptionCount()} 个 &gt;</strong>
                    </button>
                    <MenuV2.Separator />
                    <MenuV2.Item disabled={loggingOut()} onSelect={logout}>
                      {loggingOut() ? "正在退出..." : "退出登录"}
                    </MenuV2.Item>
                  </>
                }
              >
                <div class="mbm-user-menu-detail-header">
                  <button type="button" onClick={() => setShowSubscriptions(false)}>
                    &lt;
                  </button>
                  <strong>生效套餐</strong>
                  <span>{subscriptionCount()} 个</span>
                </div>
                <div class="mbm-user-menu-subscriptions">
                  <Show
                    when={!subscriptionLoading()}
                    fallback={<div class="mbm-user-menu-empty">正在加载...</div>}
                  >
                    <Show
                      when={subscriptions().length > 0}
                      fallback={<div class="mbm-user-menu-empty">暂无生效套餐</div>}
                    >
                      <For each={subscriptions()}>
                        {(subscription) => (
                          <div class="mbm-user-menu-subscription">
                            <strong>{subscription.title}</strong>
                            <span>
                              剩余 {formatTokens(subscription.amount_total - subscription.amount_used)}
                              <Show when={subscription.end_time}> · {formatDate(subscription.end_time)} 到期</Show>
                            </span>
                          </div>
                        )}
                      </For>
                    </Show>
                  </Show>
                </div>
              </Show>
            </MenuV2.Content>
          </MenuV2.Portal>
        </MenuV2>
      )}
    </Show>
  )
}

function formatTokens(value: number) {
  return new Intl.NumberFormat().format(Math.max(0, value))
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(timestamp * 1000),
  )
}
