export * as MopcSkill from "./mopc"

import path from "path"
import fs from "fs/promises"
import { BlobReader, Uint8ArrayWriter, ZipReader } from "@zip.js/zip.js"
import { Effect, Schema } from "effect"
import { FSUtil } from "../fs-util"
import { Global } from "../global"
import { AbsolutePath } from "../schema"
import { MopcSession } from "../mopc/session"

const root = path.join(Global.Path.cache, "mopc", "skills")
const manifestName = "manifest.json"

class AcquiredSkill extends Schema.Class<AcquiredSkill>("MopcSkill.AcquiredSkill")({
  id: Schema.Union([Schema.String, Schema.Number]),
  title: Schema.String.pipe(Schema.optional),
  description: Schema.String.pipe(Schema.optional),
  package_url: Schema.String,
  updated_at: Schema.Union([Schema.String, Schema.Number]).pipe(Schema.optional),
  content_hash: Schema.String,
  skill_md_tokens: Schema.Number.pipe(Schema.optional),
  token_multiplier: Schema.Number.pipe(Schema.optional),
}) {}

const AcquiredResponse = Schema.Struct({
  success: Schema.Boolean.pipe(Schema.optional),
  message: Schema.String.pipe(Schema.optional),
  data: Schema.Struct({
    skills: Schema.Array(AcquiredSkill).pipe(Schema.optional),
  }).pipe(Schema.optional),
})

export class Manifest extends Schema.Class<Manifest>("MopcSkill.Manifest")({
  skill_id: Schema.String,
  content_hash: Schema.String,
  package_url: Schema.String,
  skill_md_path: AbsolutePath,
  updated_at: Schema.Number,
}) {}

export class BillingError extends Schema.TaggedErrorClass<BillingError>()("MopcSkill.BillingError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export function cacheDirectory(session: MopcSession.Info) {
  return path.join(root, String(session.user.id))
}

export const manifests = Effect.fn("MopcSkill.manifests")(function* () {
  const fs = yield* FSUtil.Service
  const session = yield* MopcSession.get()
  if (!session) return [] as Manifest[]
  const files = yield* fs
    .glob(`*/${manifestName}`, { cwd: cacheDirectory(session), absolute: true, include: "file", dot: true })
    .pipe(Effect.catch(() => Effect.succeed([] as string[])))
  return (yield* Effect.all(
    files.map((file) =>
      fs.readJson(file).pipe(
        Effect.map((data) => Schema.decodeUnknownOption(Manifest)(data).valueOrUndefined),
        Effect.catch(() => Effect.succeed(undefined)),
      ),
    ),
  )).filter((item): item is Manifest => item !== undefined)
})

export const sync = Effect.fn("MopcSkill.sync")(function* () {
  const fs = yield* FSUtil.Service
  const session = yield* MopcSession.get()
  if (!session) return [] as Manifest[]
  yield* fs.ensureDir(cacheDirectory(session))

  const response = yield* fetchJson(`${session.api_base_url}/tools/skills/acquired`, session)
  const decoded = yield* Schema.decodeUnknownEffect(AcquiredResponse)(response).pipe(
    Effect.mapError((cause) => new BillingError({ message: "Invalid acquired skills response", cause })),
  )
  if (decoded.success === false) {
    return yield* Effect.fail(new BillingError({ message: decoded.message ?? "Failed to load acquired skills" }))
  }

  const acquired = decoded.data?.skills ?? []
  const acquiredIDs = new Set(acquired.map((item) => String(item.id)))
  const synced = yield* Effect.all(
    acquired.map((item) => syncSkill(session, item).pipe(Effect.catch(() => Effect.succeed(undefined)))),
    { concurrency: 4 },
  )
  yield* removeStaleSkills(session, acquiredIDs)
  return synced.filter((item): item is Manifest => item !== undefined)
})

export const bill = Effect.fn("MopcSkill.bill")(function* (
  remote: { skill_id: string },
  context: { sessionID: string; assistantMessageID: string; toolCallID: string },
) {
  const session = yield* MopcSession.get()
  if (!session) return yield* Effect.fail(new BillingError({ message: "MOPC session is not configured" }))
  const idempotencyKey = `${context.sessionID}:${context.assistantMessageID}:${context.toolCallID}`
  const response = yield* fetchJson(`${session.api_base_url}/tools/skills/${remote.skill_id}/call-billing`, session, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ idempotency_key: idempotencyKey }),
  })
  if (isFailureResponse(response)) {
    return yield* Effect.fail(new BillingError({ message: response.message ?? "MOPC skill billing failed" }))
  }
})

const syncSkill = Effect.fn("MopcSkill.syncSkill")(function* (session: MopcSession.Info, item: AcquiredSkill) {
  const fs = yield* FSUtil.Service
  const skillID = String(item.id)
  const contentHash = item.content_hash || String(item.updated_at ?? item.package_url)
  const directory = path.join(cacheDirectory(session), safeSegment(skillID))
  const manifestPath = path.join(directory, manifestName)
  const existing = yield* fs.readJson(manifestPath).pipe(
    Effect.map((data) => Schema.decodeUnknownOption(Manifest)(data).valueOrUndefined),
    Effect.catch(() => Effect.succeed(undefined)),
  )
  if (existing?.content_hash === contentHash) return existing

  const bytes = yield* Effect.tryPromise({
    try: async () => {
      const response = await fetch(item.package_url)
      if (!response.ok) throw new Error(`Download failed: ${response.status}`)
      return new Uint8Array(await response.arrayBuffer())
    },
    catch: (cause) => new BillingError({ message: `Failed to download MOPC skill ${skillID}`, cause }),
  })

  const next = `${directory}.next-${Date.now()}`
  yield* fs.remove(next).pipe(Effect.catch(() => Effect.void))
  yield* fs.ensureDir(next)
  yield* unzip(bytes, next)

  const skillFiles = yield* fs.glob("**/SKILL.md", { cwd: next, absolute: true, include: "file", dot: true })
  if (skillFiles.length !== 1) {
    yield* fs.remove(next).pipe(Effect.catch(() => Effect.void))
    return yield* Effect.fail(new BillingError({ message: `MOPC skill ${skillID} must contain exactly one SKILL.md` }))
  }

  yield* fs.remove(directory).pipe(Effect.catch(() => Effect.void))
  yield* fs.rename(next, directory)
  const manifest = new Manifest({
    skill_id: skillID,
    content_hash: contentHash,
    package_url: item.package_url,
    skill_md_path: AbsolutePath.make(path.join(directory, path.relative(next, skillFiles[0]))),
    updated_at: Date.now(),
  })
  yield* fs.writeJson(manifestPath, manifest, 0o600)
  return manifest
})

const removeStaleSkills = Effect.fn("MopcSkill.removeStaleSkills")(function* (
  session: MopcSession.Info,
  acquiredIDs: Set<string>,
) {
  const fs = yield* FSUtil.Service
  const directory = cacheDirectory(session)
  const entries = yield* fs.readDirectoryEntries(directory).pipe(Effect.catch(() => Effect.succeed([])))
  yield* Effect.forEach(
    entries.filter((entry) => entry.type === "directory" && !entry.name.includes(".next-")),
    Effect.fn(function* (entry) {
      const target = path.join(directory, entry.name)
      const manifest = yield* fs.readJson(path.join(target, manifestName)).pipe(
        Effect.map((data) => Schema.decodeUnknownOption(Manifest)(data).valueOrUndefined),
        Effect.catch(() => Effect.succeed(undefined)),
      )
      if (!manifest) return
      if (acquiredIDs.has(manifest.skill_id)) return
      yield* fs.remove(target).pipe(Effect.catch(() => Effect.void))
    }),
    { concurrency: 4, discard: true },
  )
})

const unzip = Effect.fn("MopcSkill.unzip")(function* (bytes: Uint8Array, target: string) {
  yield* Effect.tryPromise({
    try: async () => {
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
      const reader = new ZipReader(new BlobReader(new Blob([buffer])))
      try {
        for (const entry of await reader.getEntries()) {
          if (!entry.filename || entry.directory || !entry.getData) continue
          const output = path.resolve(target, entry.filename)
          if (!FSUtil.contains(target, output)) throw new Error(`Unsafe zip entry: ${entry.filename}`)
          await fs.mkdir(path.dirname(output), { recursive: true })
          await fs.writeFile(output, await entry.getData(new Uint8ArrayWriter()))
        }
      } finally {
        await reader.close()
      }
    },
    catch: (cause) => new BillingError({ message: "Failed to extract MOPC skill package", cause }),
  })
})

function safeSegment(input: string) {
  return input.replace(/[^A-Za-z0-9._-]/g, "_")
}

const fetchJson = Effect.fn("MopcSkill.fetchJson")(function* (
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
      if (!response.ok) throw new Error(body?.message ?? `Request failed: ${response.status}`)
      return body
    },
    catch: (cause) => new BillingError({ message: `MOPC request failed: ${url}`, cause }),
  })
})

function isFailureResponse(input: unknown): input is { success?: boolean; message?: string } {
  return input !== null && typeof input === "object" && "success" in input && (input as { success?: boolean }).success === false
}
