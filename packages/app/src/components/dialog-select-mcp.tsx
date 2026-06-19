import { Component, createMemo, createResource, createSignal, Show } from "solid-js"
import { useSync } from "@/context/sync"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { Switch } from "@opencode-ai/ui/switch"
import { useLanguage } from "@/context/language"
import { useMcpToggle } from "@/context/mcp"
import { useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { usePlatform } from "@/context/platform"
import { authTokenFromCredentials } from "@/utils/server"

const statusLabels = {
  connected: "mcp.status.connected",
  failed: "mcp.status.failed",
  needs_auth: "mcp.status.needs_auth",
  needs_client_registration: "mcp.status.needs_client_registration",
  disabled: "mcp.status.disabled",
} as const

export const DialogSelectMcp: Component = () => {
  const sync = useSync()
  const language = useLanguage()
  const server = useServer()
  const serverSDK = useServerSDK()
  const platform = usePlatform()

  const [remoteToolPending, setRemoteToolPending] = createSignal("")
  const [remoteTools, { refetch: refetchRemoteTools }] = createResource(async () => {
    const current = server.current
    if (!current) return []
    const headers = current.http.password
      ? {
          Authorization: `Basic ${authTokenFromCredentials({
            username: current.http.username,
            password: current.http.password,
          })}`,
        }
      : undefined
    const res = await (platform.fetch ?? fetch)(`${serverSDK().url}/api/mopc/tools`, {
      headers: {
        Accept: "application/json",
        ...headers,
      },
    })
    if (!res.ok) return []
    return ((await res.json().catch(() => [])) ?? []) as Array<{
      id: string
      tool_id: string
      tool_name: string
      tool_description?: string
      action_name: string
      description: string
      enabled: boolean
    }>
  })

  const mopcFetch = async (path: string, init?: RequestInit) => {
    const current = server.current
    if (!current) throw new Error("No opencode server is available")
    const headers = current.http.password
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
        ...headers,
        ...(init?.headers ?? {}),
      },
    })
    if (!res.ok) throw new Error(`MOPC request failed (${res.status})`)
    if (res.status === 204) return undefined
    return res.json()
  }

  const toggleRemoteTool = async (toolID: string, enabled: boolean) => {
    if (remoteToolPending()) return
    setRemoteToolPending(toolID)
    try {
      await mopcFetch(`/api/mopc/tools/${encodeURIComponent(toolID)}/enabled`, {
        method: "PUT",
        body: JSON.stringify({ enabled }),
      })
      await refetchRemoteTools()
      await serverSDK()
        .client.global.dispose()
        .catch(() => undefined)
    } finally {
      setRemoteToolPending("")
    }
  }

  const items = createMemo(() =>
    [
      ...Object.entries(sync().data.mcp ?? {}).map(([name, status]) => ({
        type: "mcp" as const,
        name,
        status: status.status,
      })),
      ...Object.values(
        (remoteTools() ?? []).reduce<
          Record<
            string,
            {
              type: "remote"
              toolID: string
              name: string
              status: "remote"
              description: string
              actions: string[]
              enabled: boolean
            }
          >
        >((acc, tool) => {
          const key = tool.tool_id
          acc[key] ??= {
            type: "remote",
            toolID: tool.tool_id,
            name: tool.tool_name,
            status: "remote",
            description: tool.tool_description || "",
            actions: [],
            enabled: tool.enabled,
          }
          acc[key].enabled = acc[key].enabled || tool.enabled
          acc[key].actions.push(tool.action_name)
          return acc
        }, {}),
      ).map((tool) => ({
        type: "remote" as const,
        toolID: tool.toolID,
        name: tool.name,
        status: "remote" as const,
        description: tool.description || `${tool.actions.length} actions`,
        enabled: tool.enabled,
      })),
    ]
      .sort((a, b) => a.name.localeCompare(b.name)),
  )

  const toggle = useMcpToggle()

  const enabledCount = createMemo(() =>
    items().filter((i) => (i.type === "mcp" ? i.status === "connected" : i.enabled)).length,
  )
  const totalCount = createMemo(() => items().length)

  return (
    <Dialog
      title={language.t("dialog.mcp.title")}
      description={language.t("dialog.mcp.description", { enabled: enabledCount(), total: totalCount() })}
    >
      <List
        class="px-3"
        search={{ placeholder: language.t("common.search.placeholder"), autofocus: true }}
        emptyMessage={language.t("dialog.mcp.empty")}
        key={(x) => x?.name ?? ""}
        items={items}
        filterKeys={["name", "status"]}
        sortBy={(a, b) => a.name.localeCompare(b.name)}
        onSelect={(x) => {
          if (!x || toggle.isPending) return
          if (x.type === "remote") {
            void toggleRemoteTool(x.toolID, !x.enabled)
            return
          }
          toggle.mutate(x.name)
        }}
      >
        {(i) => {
          const mcpStatus = () => sync().data.mcp[i.name]
          const status = () => mcpStatus()?.status
          const statusLabel = () => {
            const key = status() ? statusLabels[status() as keyof typeof statusLabels] : undefined
            if (!key) return
            return language.t(key)
          }
          const error = () => {
            const s = mcpStatus()
            if (s?.status === "failed" || s?.status === "needs_client_registration") return s.error
          }
          const enabled = () => status() === "connected"
          return (
            <div class="w-full flex items-center justify-between gap-x-3">
              <div class="flex flex-col gap-0.5 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="truncate">{i.name}</span>
                  <Show when={i.type === "mcp" && statusLabel()}>
                    <span class="text-11-regular text-text-weaker">{statusLabel()}</span>
                  </Show>
                </div>
                <Show when={i.type === "remote" ? i.description : error()}>
                  <span class="text-11-regular text-text-weaker truncate">
                    {i.type === "remote" ? i.description : error()}
                  </span>
                </Show>
              </div>
              <div class="shrink-0" onClick={(e) => e.stopPropagation()}>
                <Show
                  when={i.type === "mcp"}
                  fallback={
                    <div class="flex items-center gap-3">
                      <span class="text-11-regular text-text-weaker">{language.t("dialog.mcp.remoteTool")}</span>
                      <Switch
                        checked={i.type === "remote" && i.enabled}
                        disabled={i.type === "remote" && remoteToolPending() === i.toolID}
                        onChange={() => {
                          if (i.type !== "remote") return
                          void toggleRemoteTool(i.toolID, !i.enabled)
                        }}
                      />
                    </div>
                  }
                >
                  <Switch
                    checked={enabled()}
                    disabled={toggle.isPending && toggle.variables === i.name}
                    onChange={() => {
                      if (toggle.isPending) return
                      toggle.mutate(i.name)
                    }}
                  />
                </Show>
              </div>
            </div>
          )
        }}
      </List>
    </Dialog>
  )
}
