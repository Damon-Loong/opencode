import { Auth } from "@/auth"
import { MopcAccount } from "@opencode-ai/core/mopc/account"
import { MopcSession } from "@opencode-ai/core/mopc/session"
import { MopcStore } from "@opencode-ai/core/mopc/store"
import { MopcTool } from "@opencode-ai/core/mopc/tool"
import { MopcSkill } from "@opencode-ai/core/skill/mopc"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError, HttpApiSchema } from "effect/unstable/httpapi"
import { RootHttpApi } from "../api"

const badRequest = () => new HttpApiError.BadRequest({})

export const mopcHandlers = HttpApiBuilder.group(RootHttpApi, "mopc", (handlers) =>
  Effect.gen(function* () {
    const auth = yield* Auth.Service

    return handlers
      .handle(
        "sessionGet",
        Effect.fn(function* () {
          const session = yield* MopcSession.get().pipe(Effect.mapError(badRequest))
          return session ? MopcSession.publicInfo(session) : null
        }),
      )
      .handle(
        "sessionSet",
        Effect.fn(function* (ctx) {
          const session = yield* MopcSession.set(ctx.payload).pipe(Effect.mapError(badRequest))
          yield* auth
            .set("mbm", {
              type: "api",
              key: ctx.payload.api_key,
            })
            .pipe(Effect.orDie)
          yield* Effect.all(
            [MopcSkill.sync().pipe(Effect.catch(() => Effect.void)), MopcTool.sync().pipe(Effect.catch(() => Effect.void))],
            { concurrency: "unbounded" },
          )
          return MopcSession.publicInfo(session)
        }),
      )
      .handle(
        "sessionClear",
        Effect.fn(function* () {
          yield* MopcSession.clear().pipe(Effect.mapError(badRequest))
          yield* auth.remove("mbm").pipe(Effect.orDie)
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "sessionSync",
        Effect.fn(function* () {
          yield* Effect.all(
            [MopcSkill.sync().pipe(Effect.catch(() => Effect.void)), MopcTool.sync().pipe(Effect.catch(() => Effect.void))],
            { concurrency: "unbounded" },
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "accountGet",
        Effect.fn(function* () {
          const account = yield* MopcAccount.get().pipe(Effect.mapError(badRequest))
          return account ?? null
        }),
      )
      .handle(
        "subscriptionsList",
        Effect.fn(function* () {
          return yield* MopcAccount.subscriptions().pipe(Effect.mapError(badRequest))
        }),
      )
      .handle(
        "toolsList",
        Effect.fn(function* () {
          return yield* MopcTool.publicDefinitions().pipe(Effect.mapError(badRequest))
        }),
      )
      .handle(
        "toolSetEnabled",
        Effect.fn(function* (ctx) {
          return yield* MopcTool.setEnabled(ctx.params.tool_id, ctx.payload.enabled).pipe(Effect.mapError(badRequest))
        }),
      )
      .handle(
        "storeSkillsList",
        Effect.fn(function* () {
          return yield* MopcStore.skills().pipe(Effect.mapError(badRequest))
        }),
      )
      .handle(
        "storeSkillAcquire",
        Effect.fn(function* (ctx) {
          yield* MopcStore.acquireSkill(ctx.params.skill_id).pipe(Effect.mapError(badRequest))
          yield* MopcSkill.sync().pipe(Effect.catch(() => Effect.void))
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "storeToolsList",
        Effect.fn(function* () {
          return yield* MopcStore.tools().pipe(Effect.mapError(badRequest))
        }),
      )
      .handle(
        "storeToolInstall",
        Effect.fn(function* (ctx) {
          yield* MopcStore.installTool(ctx.params.tool_id).pipe(Effect.mapError(badRequest))
          yield* MopcTool.sync().pipe(Effect.catch(() => Effect.void))
          return HttpApiSchema.NoContent.make()
        }),
      )
  }),
)
