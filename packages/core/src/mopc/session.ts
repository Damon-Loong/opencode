export * as MopcSession from "./session"

import path from "path"
import { Effect, Schema } from "effect"
import { FSUtil } from "../fs-util"
import { Global } from "../global"

const file = path.join(Global.Path.data, "mopc-session.json")

export class User extends Schema.Class<User>("MopcSession.User")({
  id: Schema.Number,
  username: Schema.String,
  displayName: Schema.String.pipe(Schema.optional),
}) {}

export class Info extends Schema.Class<Info>("MopcSession.Info")({
  api_base_url: Schema.String,
  user: User,
  access_token: Schema.String,
  api_key: Schema.String,
  updated_at: Schema.Number,
}) {}

export class PublicInfo extends Schema.Class<PublicInfo>("MopcSession.PublicInfo")({
  api_base_url: Schema.String,
  user: User,
  updated_at: Schema.Number,
}) {}

export class SetInput extends Schema.Class<SetInput>("MopcSession.SetInput")({
  api_base_url: Schema.String,
  user: User,
  access_token: Schema.String,
  api_key: Schema.String,
}) {}

const decodeInfo = Schema.decodeUnknownOption(Info)

export const get = Effect.fn("MopcSession.get")(function* () {
  const fs = yield* FSUtil.Service
  const data = yield* fs.readJson(file).pipe(Effect.orElseSucceed(() => undefined))
  if (!data) return undefined
  return decodeInfo(data).valueOrUndefined
})

export const set = Effect.fn("MopcSession.set")(function* (input: SetInput) {
  const fs = yield* FSUtil.Service
  const info = new Info({
    ...input,
    api_base_url: input.api_base_url.replace(/\/+$/, ""),
    updated_at: Date.now(),
  })
  yield* fs.writeJson(file, info, 0o600)
  return info
})

export const clear = Effect.fn("MopcSession.clear")(function* () {
  const fs = yield* FSUtil.Service
  yield* fs.remove(file).pipe(Effect.catch(() => Effect.void))
})

export function publicInfo(info: Info) {
  return new PublicInfo({
    api_base_url: info.api_base_url,
    user: info.user,
    updated_at: info.updated_at,
  })
}
