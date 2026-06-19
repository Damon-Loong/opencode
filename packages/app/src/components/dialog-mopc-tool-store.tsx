import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Tabs } from "@opencode-ai/ui/tabs"
import { showToast } from "@/utils/toast"
import { createMemo, createResource, createSignal, For, Show } from "solid-js"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { authTokenFromCredentials } from "@/utils/server"

type StoreSkill = {
  id: number
  title: string
  description: string
  acquired: boolean
  token_multiplier?: number
  skill_md_tokens?: number
  created_by_name?: string
}

type StoreTool = {
  id: string
  name: string
  description: string
  installed: boolean
  action_count: number
  call_price?: number
  created_by_name?: string
  category?: string
}

export function DialogMopcToolStore(props: { onChanged?: () => void | Promise<void> }) {
  const dialog = useDialog()
  const platform = usePlatform()
  const server = useServer()
  const serverSDK = useServerSDK()
  const [tab, setTab] = createSignal("skills")
  const [filter, setFilter] = createSignal("")
  const [pending, setPending] = createSignal("")

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
    if (!res.ok) throw new Error(`MOPC request failed (${res.status})`)
    if (res.status === 204) return undefined
    return (await res.json().catch(() => undefined)) as T | undefined
  }

  const [skills, { refetch: refetchSkills }] = createResource(async () => {
    return (await mopcFetch<StoreSkill[]>("/api/mopc/store/skills").catch(() => [])) ?? []
  })
  const [tools, { refetch: refetchTools }] = createResource(async () => {
    return (await mopcFetch<StoreTool[]>("/api/mopc/store/tools").catch(() => [])) ?? []
  })

  const skillItems = createMemo(() => filterItems(skills() ?? [], filter(), (item) => [item.title, item.description]))
  const toolItems = createMemo(() => filterItems(tools() ?? [], filter(), (item) => [item.name, item.description]))

  const acquireSkill = async (skill: StoreSkill) => {
    if (pending() || skill.acquired) return
    setPending(`skill:${skill.id}`)
    try {
      await mopcFetch(`/api/mopc/store/skills/${skill.id}/acquire`, { method: "POST" })
      await refetchSkills()
      await serverSDK().client.global.dispose()
      await props.onChanged?.()
      showToast({ variant: "success", title: "已获取 Skill" })
    } catch (err) {
      showToast({
        variant: "error",
        title: "获取 Skill 失败",
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setPending("")
    }
  }

  const installTool = async (tool: StoreTool) => {
    if (pending() || tool.installed) return
    setPending(`tool:${tool.id}`)
    try {
      await mopcFetch(`/api/mopc/store/tools/${encodeURIComponent(tool.id)}/install`, { method: "POST" })
      await refetchTools()
      await serverSDK().client.global.dispose()
      await props.onChanged?.()
      showToast({ variant: "success", title: "已获取 MCP 工具" })
    } catch (err) {
      showToast({
        variant: "error",
        title: "获取 MCP 工具失败",
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setPending("")
    }
  }

  return (
    <Dialog title="工具商店" class="w-full max-w-[720px] mx-auto">
      <div class="flex flex-col gap-3 px-4 pb-4">
        <input
          class="h-9 w-full rounded-md border border-border-base bg-background-base px-3 text-14-regular text-text-base outline-none placeholder:text-text-weaker focus:border-border-strong"
          value={filter()}
          placeholder="搜索 Skills 或 MCP 工具"
          onInput={(event) => setFilter(event.currentTarget.value)}
        />
        <Tabs defaultValue="skills" value={tab()} onChange={setTab} variant="alt" class="tabs">
          <Tabs.List data-slot="tablist" class="bg-transparent px-0 pt-0 pb-0 gap-4 h-9">
            <Tabs.Trigger value="skills" data-slot="tab" class="text-12-regular">
              Skills
            </Tabs.Trigger>
            <Tabs.Trigger value="tools" data-slot="tab" class="text-12-regular">
              MCP 工具
            </Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="skills">
            <div class="flex flex-col gap-2 max-h-[420px] overflow-auto pt-2">
              <Show when={!skills.loading} fallback={<StoreEmpty>正在加载 Skills...</StoreEmpty>}>
                <Show when={skillItems().length > 0} fallback={<StoreEmpty>暂无可获取 Skills</StoreEmpty>}>
                  <For each={skillItems()}>
                    {(skill) => (
                      <StoreRow
                        title={skill.title}
                        description={skill.description}
                        meta={skillMeta(skill)}
                        acquired={skill.acquired}
                        pending={pending() === `skill:${skill.id}`}
                        onAcquire={() => void acquireSkill(skill)}
                      />
                    )}
                  </For>
                </Show>
              </Show>
            </div>
          </Tabs.Content>
          <Tabs.Content value="tools">
            <div class="flex flex-col gap-2 max-h-[420px] overflow-auto pt-2">
              <Show when={!tools.loading} fallback={<StoreEmpty>正在加载 MCP 工具...</StoreEmpty>}>
                <Show when={toolItems().length > 0} fallback={<StoreEmpty>暂无可获取 MCP 工具</StoreEmpty>}>
                  <For each={toolItems()}>
                    {(tool) => (
                      <StoreRow
                        title={tool.name}
                        description={tool.description}
                        meta={toolMeta(tool)}
                        acquired={tool.installed}
                        pending={pending() === `tool:${tool.id}`}
                        onAcquire={() => void installTool(tool)}
                      />
                    )}
                  </For>
                </Show>
              </Show>
            </div>
          </Tabs.Content>
        </Tabs>
        <div class="flex justify-end pt-1">
          <Button variant="ghost" size="large" onClick={() => dialog.close()}>
            关闭
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

function StoreRow(props: {
  title: string
  description: string
  meta: string
  acquired: boolean
  pending: boolean
  onAcquire: () => void
}) {
  return (
    <div class="flex items-center gap-3 rounded-md border border-border-base bg-background-base px-3 py-2">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <span class="text-14-medium text-text-base truncate">{props.title}</span>
          <Show when={props.meta}>
            <span class="text-11-regular text-text-weaker truncate">{props.meta}</span>
          </Show>
        </div>
        <Show when={props.description}>
          <div class="text-12-regular text-text-weaker truncate mt-0.5">{props.description}</div>
        </Show>
      </div>
      <Button
        variant={props.acquired ? "secondary" : "primary"}
        size="small"
        disabled={props.acquired || props.pending}
        onClick={props.onAcquire}
      >
        {props.pending ? "获取中..." : props.acquired ? "已获取" : "获取"}
      </Button>
    </div>
  )
}

function StoreEmpty(props: { children: string }) {
  return <div class="text-14-regular text-text-weaker text-center py-12">{props.children}</div>
}

function filterItems<T>(items: T[], filter: string, fields: (item: T) => string[]) {
  const keyword = filter.trim().toLowerCase()
  if (!keyword) return items
  return items.filter((item) => fields(item).some((value) => value.toLowerCase().includes(keyword)))
}

function skillMeta(skill: StoreSkill) {
  const parts = [
    skill.created_by_name,
    skill.skill_md_tokens ? `${formatNumber(skill.skill_md_tokens)} tokens` : "",
    skill.token_multiplier ? `${skill.token_multiplier}x` : "",
  ].filter(Boolean)
  return parts.join(" · ")
}

function toolMeta(tool: StoreTool) {
  const parts = [
    tool.created_by_name,
    tool.category,
    tool.action_count ? `${tool.action_count} actions` : "",
    tool.call_price ? `${formatNumber(tool.call_price)} tokens/次` : "",
  ].filter(Boolean)
  return parts.join(" · ")
}

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value)
}
