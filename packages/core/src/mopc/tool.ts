export * as MopcTool from "./tool"

import path from "path"
import { Effect, Option, Schema } from "effect"
import { FSUtil } from "../fs-util"
import { Global } from "../global"
import { MopcSession } from "./session"

const root = path.join(Global.Path.cache, "mopc", "tools")
const manifestName = "manifest.json"
const settingsName = "settings.json"

const JsonObject = Schema.Record(Schema.String, Schema.Unknown)

class ToolSummary extends Schema.Class<ToolSummary>("MopcTool.ToolSummary")({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String.pipe(Schema.optional),
  updated_at: Schema.Number.pipe(Schema.optional),
  call_price: Schema.Number.pipe(Schema.optional),
}) {}

class ToolAction extends Schema.Class<ToolAction>("MopcTool.ToolAction")({
  id: Schema.String.pipe(Schema.optional),
  name: Schema.String.pipe(Schema.optional),
  display_name: Schema.String.pipe(Schema.optional),
  description: Schema.String.pipe(Schema.optional),
  operation_id: Schema.String.pipe(Schema.optional),
  input_schema: JsonObject.pipe(Schema.optional),
  enabled: Schema.Boolean.pipe(Schema.optional),
}) {}

class UserTool extends Schema.Class<UserTool>("MopcTool.UserTool")({
  tool_id: Schema.String,
  enabled: Schema.Boolean.pipe(Schema.optional),
  updated_at: Schema.Number.pipe(Schema.optional),
  tool: ToolSummary,
  actions: Schema.Array(ToolAction).pipe(Schema.optional),
}) {}

const UserToolsResponse = Schema.Struct({
  success: Schema.Boolean.pipe(Schema.optional),
  message: Schema.String.pipe(Schema.optional),
  data: Schema.Struct({
    tools: Schema.Array(UserTool).pipe(Schema.optional),
  }).pipe(Schema.optional),
})

const RunResponse = Schema.Struct({
  success: Schema.Boolean.pipe(Schema.optional),
  message: Schema.String.pipe(Schema.optional),
  data: Schema.Struct({
    run_id: Schema.Number.pipe(Schema.optional),
    tool_id: Schema.String.pipe(Schema.optional),
    action_id: Schema.String.pipe(Schema.optional),
    function_name: Schema.String.pipe(Schema.optional),
    status: Schema.String.pipe(Schema.optional),
    result: Schema.Unknown.pipe(Schema.optional),
    result_text: Schema.String.pipe(Schema.optional),
    error_message: Schema.String.pipe(Schema.optional),
    duration_ms: Schema.Number.pipe(Schema.optional),
  }).pipe(Schema.optional),
})

export class Definition extends Schema.Class<Definition>("MopcTool.Definition")({
  id: Schema.String,
  tool_id: Schema.String,
  action_id: Schema.String,
  tool_name: Schema.String,
  tool_description: Schema.String.pipe(Schema.optional),
  action_name: Schema.String,
  description: Schema.String,
  input_schema: JsonObject,
  updated_at: Schema.Number,
}) {}

export class Manifest extends Schema.Class<Manifest>("MopcTool.Manifest")({
  user_id: Schema.Number,
  updated_at: Schema.Number,
  tools: Schema.Array(Definition),
}) {}

export class Settings extends Schema.Class<Settings>("MopcTool.Settings")({
  disabled_tool_ids: Schema.Array(Schema.String),
}) {}

export class PublicDefinition extends Schema.Class<PublicDefinition>("MopcTool.PublicDefinition")({
  ...Definition.fields,
  enabled: Schema.Boolean,
}) {}

export class Error extends Schema.TaggedErrorClass<Error>()("MopcTool.Error", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export function cacheDirectory(session: MopcSession.Info) {
  return path.join(root, String(session.user.id))
}

export const manifest = Effect.fn("MopcTool.manifest")(function* () {
  const fs = yield* FSUtil.Service
  const session = yield* MopcSession.get()
  if (!session) return undefined
  return yield* fs.readJson(path.join(cacheDirectory(session), manifestName)).pipe(
    Effect.map((data) => Schema.decodeUnknownOption(Manifest)(data).valueOrUndefined),
    Effect.catch(() => Effect.succeed(undefined)),
  )
})

export const definitions = Effect.fn("MopcTool.definitions")(function* () {
  const settings = yield* readSettings()
  return ((yield* manifest())?.tools ?? []).filter((item) => !settings.disabled_tool_ids.includes(item.tool_id))
})

export const publicDefinitions = Effect.fn("MopcTool.publicDefinitions")(function* () {
  const settings = yield* readSettings()
  return ((yield* manifest())?.tools ?? []).map(
    (item) =>
      new PublicDefinition({
        ...item,
        enabled: !settings.disabled_tool_ids.includes(item.tool_id),
      }),
  )
})

export const setEnabled = Effect.fn("MopcTool.setEnabled")(function* (toolID: string, enabled: boolean) {
  const fs = yield* FSUtil.Service
  const session = yield* MopcSession.get()
  if (!session) return yield* Effect.fail(new Error({ message: "MOPC session is not configured" }))
  const settings = yield* readSettingsFor(session)
  const disabled = new Set<string>(settings.disabled_tool_ids)
  if (enabled) disabled.delete(toolID)
  else disabled.add(toolID)
  const next = new Settings({ disabled_tool_ids: Array.from(disabled).toSorted() })
  yield* fs.writeJson(path.join(cacheDirectory(session), settingsName), next, 0o600)
  return next
})

export const sync = Effect.fn("MopcTool.sync")(function* () {
  const fs = yield* FSUtil.Service
  const session = yield* MopcSession.get()
  if (!session) return [] as Definition[]
  yield* fs.ensureDir(cacheDirectory(session))

  const response = yield* fetchJson(`${session.api_base_url}/user/tools`, session)
  const decoded = yield* Schema.decodeUnknownEffect(UserToolsResponse)(response).pipe(
    Effect.mapError((cause) => new Error({ message: "Invalid MOPC tools response", cause })),
  )
  if (decoded.success === false) {
    return yield* Effect.fail(new Error({ message: decoded.message ?? "Failed to load MOPC tools" }))
  }

  const userTools = decoded.data?.tools ?? []
  const currentToolIDs = new Set(userTools.filter((item) => item.enabled !== false).map((item) => item.tool_id))
  const tools = userTools.flatMap((item) =>
    item.enabled === false
      ? []
      : (item.actions ?? [])
          .filter((action) => action.enabled !== false)
          .map((action) => definition(item, action))
          .filter((item): item is Definition => item !== undefined),
  )
  yield* pruneSettings(session, currentToolIDs)
  yield* fs.writeJson(
    path.join(cacheDirectory(session), manifestName),
    new Manifest({ user_id: session.user.id, updated_at: Date.now(), tools }),
    0o600,
  )
  return tools
})

const pruneSettings = Effect.fn("MopcTool.pruneSettings")(function* (session: MopcSession.Info, currentToolIDs: Set<string>) {
  const fs = yield* FSUtil.Service
  const settings = yield* readSettingsFor(session)
  const disabled = settings.disabled_tool_ids.filter((toolID) => currentToolIDs.has(toolID))
  if (disabled.length === settings.disabled_tool_ids.length) return
  yield* fs.writeJson(path.join(cacheDirectory(session), settingsName), new Settings({ disabled_tool_ids: disabled }), 0o600)
})

const readSettings = Effect.fn("MopcTool.readSettings")(function* () {
  const session = yield* MopcSession.get()
  if (!session) return new Settings({ disabled_tool_ids: [] })
  return yield* readSettingsFor(session)
})

const readSettingsFor = Effect.fn("MopcTool.readSettingsFor")(function* (session: MopcSession.Info) {
  const fs = yield* FSUtil.Service
  return yield* fs.readJson(path.join(cacheDirectory(session), settingsName)).pipe(
    Effect.map((data) =>
      Option.getOrElse(Schema.decodeUnknownOption(Settings)(data), () => new Settings({ disabled_tool_ids: [] })),
    ),
    Effect.catch(() => Effect.succeed(new Settings({ disabled_tool_ids: [] }))),
  )
})

export const run = Effect.fn("MopcTool.run")(function* (
  def: Pick<Definition, "tool_id" | "action_id">,
  input: {
    arguments: unknown
    conversation_id: string
    message_id: string
    tool_call_id?: string
  },
) {
  const session = yield* MopcSession.get()
  if (!session) return yield* Effect.fail(new Error({ message: "MOPC session is not configured" }))
  const response = yield* fetchJson(
    `${session.api_base_url}/tools/${encodeURIComponent(def.tool_id)}/actions/${encodeURIComponent(def.action_id)}/run`,
    session,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  )
  const decoded = yield* Schema.decodeUnknownEffect(RunResponse)(response).pipe(
    Effect.mapError((cause) => new Error({ message: "Invalid MOPC tool run response", cause })),
  )
  if (decoded.success === false) {
    return yield* Effect.fail(
      new Error({
        message: decoded.data?.error_message ?? decoded.message ?? "MOPC tool run failed",
      }),
    )
  }
  if (!decoded.data) return ""
  if (decoded.data.result_text) return decoded.data.result_text
  if (decoded.data.error_message) return decoded.data.error_message
  return stringify(decoded.data.result ?? {})
})

function definition(item: UserTool, action: ToolAction) {
  const actionID = action.id || action.operation_id || action.name
  if (!actionID) return undefined
  const actionName = action.display_name || action.operation_id || action.name || actionID
  return new Definition({
    id: scopedToolName(item.tool_id, action),
    tool_id: item.tool_id,
    action_id: actionID,
    tool_name: item.tool.name,
    tool_description: item.tool.description,
    action_name: actionName,
    description: action.description || actionName,
    input_schema: action.input_schema ?? { type: "object", properties: {} },
    updated_at: item.updated_at ?? item.tool.updated_at ?? Date.now(),
  })
}

function scopedToolName(toolID: string, action: ToolAction) {
  const toolPart = sanitize(toolID).replace(/^tool_/, "").slice(0, 18)
  return `mopc_${toolPart}_${sanitize(action.operation_id || action.name || action.id || "tool_action")}`.slice(0, 64)
}

function sanitize(input: string) {
  return input.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/^_+/, "") || "tool_action"
}

function stringify(input: unknown) {
  if (typeof input === "string") return input
  return JSON.stringify(input)
}

const fetchJson = Effect.fn("MopcTool.fetchJson")(function* (
  url: string,
  session: MopcSession.Info,
  init?: RequestInit,
) {
  return yield* Effect.tryPromise({
    try: async () => {
      const response = await fetch(url, {
        ...init,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
          "New-API-User": String(session.user.id),
          ...(init?.headers ?? {}),
        },
      })
      const body = (await response.json().catch(() => null)) as { message?: string } | null
      if (!response.ok) throw new globalThis.Error(body?.message ?? `Request failed: ${response.status}`)
      return body
    },
    catch: (cause) => new Error({ message: `MOPC request failed: ${url}`, cause }),
  })
})
