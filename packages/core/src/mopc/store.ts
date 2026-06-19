export * as MopcStore from "./store"

import { Effect, Schema } from "effect"
import { MopcSession } from "./session"

const StoreSkillResponse = Schema.Struct({
  success: Schema.Boolean.pipe(Schema.optional),
  message: Schema.String.pipe(Schema.optional),
  data: Schema.Struct({
    skills: Schema.Array(Schema.Unknown).pipe(Schema.optional),
  }).pipe(Schema.optional),
})

const StoreToolResponse = Schema.Struct({
  success: Schema.Boolean.pipe(Schema.optional),
  message: Schema.String.pipe(Schema.optional),
  data: Schema.Struct({
    tools: Schema.Array(Schema.Unknown).pipe(Schema.optional),
  }).pipe(Schema.optional),
})

const StoreActionResponse = Schema.Struct({
  success: Schema.Boolean.pipe(Schema.optional),
  message: Schema.String.pipe(Schema.optional),
})

export class Skill extends Schema.Class<Skill>("MopcStore.Skill")({
  id: Schema.Number,
  title: Schema.String,
  description: Schema.String,
  acquired: Schema.Boolean,
  token_multiplier: Schema.Number.pipe(Schema.optional),
  skill_md_tokens: Schema.Number.pipe(Schema.optional),
  created_by_name: Schema.String.pipe(Schema.optional),
}) {}

export class Tool extends Schema.Class<Tool>("MopcStore.Tool")({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  installed: Schema.Boolean,
  action_count: Schema.Number,
  call_price: Schema.Number.pipe(Schema.optional),
  created_by_name: Schema.String.pipe(Schema.optional),
  category: Schema.String.pipe(Schema.optional),
}) {}

export class Error extends Schema.TaggedErrorClass<Error>()("MopcStore.Error", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export const skills = Effect.fn("MopcStore.skills")(function* () {
  const session = yield* requireSession()
  const response = yield* fetchJson(`${session.api_base_url}/tools/public-skills?limit=100`, session)
  const decoded = yield* Schema.decodeUnknownEffect(StoreSkillResponse)(response).pipe(
    Effect.mapError((cause) => new Error({ message: "Invalid MOPC store skills response", cause })),
  )
  if (decoded.success === false) {
    return yield* Effect.fail(new Error({ message: decoded.message ?? "Failed to load MOPC store skills" }))
  }
  return (decoded.data?.skills ?? [])
    .map((item) => record(item))
    .filter((item): item is Record<string, unknown> => item !== undefined)
    .map(
      (item) =>
        new Skill({
          id: readNumber(item, ["id"]) ?? 0,
          title: readString(item, ["title", "name"]) ?? "",
          description: readString(item, ["description"]) ?? "",
          acquired: readBoolean(item, ["acquired"]),
          token_multiplier: readNumber(item, ["token_multiplier"]),
          skill_md_tokens: readNumber(item, ["skill_md_tokens"]),
          created_by_name: readString(item, ["created_by_name"]),
        }),
    )
    .filter((item) => item.id > 0 && item.title)
})

export const tools = Effect.fn("MopcStore.tools")(function* () {
  const session = yield* requireSession()
  const response = yield* fetchJson(`${session.api_base_url}/tools?scope=recommended&limit=100`, session)
  const decoded = yield* Schema.decodeUnknownEffect(StoreToolResponse)(response).pipe(
    Effect.mapError((cause) => new Error({ message: "Invalid MOPC store tools response", cause })),
  )
  if (decoded.success === false) {
    return yield* Effect.fail(new Error({ message: decoded.message ?? "Failed to load MOPC store tools" }))
  }
  return (decoded.data?.tools ?? [])
    .map((item) => record(item))
    .filter((item): item is Record<string, unknown> => item !== undefined)
    .map(
      (item) =>
        new Tool({
          id: readString(item, ["id", "tool_id", "slug"]) ?? "",
          name: readString(item, ["name"]) ?? "",
          description: readString(item, ["description"]) ?? "",
          installed: readBoolean(item, ["installed", "acquired"]),
          action_count: readNumber(item, ["action_count"]) ?? 0,
          call_price: readNumber(item, ["call_price"]),
          created_by_name: readString(item, ["created_by_name"]),
          category: readString(item, ["category"]),
        }),
    )
    .filter((item) => item.id && item.name)
})

export const acquireSkill = Effect.fn("MopcStore.acquireSkill")(function* (skillID: number) {
  const session = yield* requireSession()
  const response = yield* fetchJson(`${session.api_base_url}/tools/skills/${skillID}/acquire`, session, {
    method: "POST",
  })
  yield* ensureActionSuccess(response, "Failed to acquire MOPC skill")
})

export const installTool = Effect.fn("MopcStore.installTool")(function* (toolID: string) {
  const session = yield* requireSession()
  const response = yield* fetchJson(`${session.api_base_url}/tools/${encodeURIComponent(toolID)}/install`, session, {
    method: "POST",
  })
  yield* ensureActionSuccess(response, "Failed to install MOPC tool")
})

const requireSession = Effect.fn("MopcStore.requireSession")(function* () {
  const session = yield* MopcSession.get()
  if (!session) return yield* Effect.fail(new Error({ message: "MOPC session is not configured" }))
  return session
})

const ensureActionSuccess = Effect.fn("MopcStore.ensureActionSuccess")(function* (response: unknown, fallback: string) {
  const decoded = yield* Schema.decodeUnknownEffect(StoreActionResponse)(response).pipe(
    Effect.mapError((cause) => new Error({ message: "Invalid MOPC store action response", cause })),
  )
  if (decoded.success === false) {
    return yield* Effect.fail(new Error({ message: decoded.message ?? fallback }))
  }
})

function record(input: unknown) {
  return input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : undefined
}

function readNumber(input: Record<string, unknown>, keys: string[]) {
  return keys.map((key) => number(input[key])).find((value) => value !== undefined)
}

function number(input: unknown) {
  if (typeof input === "number" && Number.isFinite(input)) return input
  if (typeof input !== "string") return undefined
  const parsed = Number(input.trim())
  return Number.isFinite(parsed) ? parsed : undefined
}

function readString(input: Record<string, unknown>, keys: string[]) {
  return keys.map((key) => input[key]).find((value): value is string => typeof value === "string")
}

function readBoolean(input: Record<string, unknown>, keys: string[]) {
  return keys.some((key) => input[key] === true)
}

const fetchJson = Effect.fn("MopcStore.fetchJson")(function* (url: string, session: MopcSession.Info, init?: RequestInit) {
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
