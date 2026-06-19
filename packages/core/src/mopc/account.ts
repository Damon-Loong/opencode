export * as MopcAccount from "./account"

import { Effect, Schema } from "effect"
import { MopcSession } from "./session"

const CurrentUserResponse = Schema.Struct({
  success: Schema.Boolean.pipe(Schema.optional),
  message: Schema.String.pipe(Schema.optional),
  data: Schema.Unknown.pipe(Schema.optional),
})

const SubscriptionSelfResponse = Schema.Struct({
  success: Schema.Boolean.pipe(Schema.optional),
  message: Schema.String.pipe(Schema.optional),
  data: Schema.Struct({
    billing_preference: Schema.String.pipe(Schema.optional),
    subscriptions: Schema.Array(Schema.Struct({ subscription: Schema.Unknown })).pipe(Schema.optional),
  }).pipe(Schema.optional),
})

const SubscriptionPlansResponse = Schema.Struct({
  success: Schema.Boolean.pipe(Schema.optional),
  message: Schema.String.pipe(Schema.optional),
  data: Schema.Array(Schema.Struct({ plan: Schema.Unknown })).pipe(Schema.optional),
})

export class Info extends Schema.Class<Info>("MopcAccount.Info")({
  remaining_tokens: Schema.Number.pipe(Schema.optional),
  quota: Schema.Number.pipe(Schema.optional),
  used_quota: Schema.Number.pipe(Schema.optional),
  request_count: Schema.Number.pipe(Schema.optional),
  group: Schema.String.pipe(Schema.optional),
  active_subscription_count: Schema.Number,
  billing_preference: Schema.String.pipe(Schema.optional),
  updated_at: Schema.Number,
}) {}

export class Subscription extends Schema.Class<Subscription>("MopcAccount.Subscription")({
  id: Schema.Number,
  plan_id: Schema.Number,
  title: Schema.String,
  subtitle: Schema.String.pipe(Schema.optional),
  status: Schema.String,
  amount_total: Schema.Number,
  amount_used: Schema.Number,
  end_time: Schema.Number,
  next_reset_time: Schema.Number.pipe(Schema.optional),
}) {}

export class Error extends Schema.TaggedErrorClass<Error>()("MopcAccount.Error", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export const get = Effect.fn("MopcAccount.get")(function* () {
  const session = yield* MopcSession.get()
  if (!session) return undefined

  const [response, subscription] = yield* Effect.all(
    [
      fetchJson(`${session.api_base_url}/user/self`, session),
      fetchSubscriptionSelf(session).pipe(Effect.catch(() => Effect.succeed(undefined))),
    ],
    { concurrency: "unbounded" },
  )
  const decoded = yield* Schema.decodeUnknownEffect(CurrentUserResponse)(response).pipe(
    Effect.mapError((cause) => new Error({ message: "Invalid MOPC account response", cause })),
  )
  if (decoded.success === false) {
    return yield* Effect.fail(new Error({ message: decoded.message ?? "Failed to load MOPC account" }))
  }

  const data = record(decoded.data) ?? record(response) ?? {}
  return new Info({
    remaining_tokens: readNumber(data, ["remaining_tokens", "remaining_token", "token_balance", "balance", "quota"]),
    quota: readNumber(data, ["quota"]),
    used_quota: readNumber(data, ["used_quota"]),
    request_count: readNumber(data, ["request_count"]),
    group: readString(data, ["group"]),
    active_subscription_count: subscription?.data?.subscriptions?.length ?? 0,
    billing_preference: subscription?.data?.billing_preference,
    updated_at: Date.now(),
  })
})

export const subscriptions = Effect.fn("MopcAccount.subscriptions")(function* () {
  const session = yield* MopcSession.get()
  if (!session) return [] as Subscription[]

  const [subscription, plans] = yield* Effect.all(
    [fetchSubscriptionSelf(session), fetchSubscriptionPlans(session).pipe(Effect.catch(() => Effect.succeed(undefined)))],
    { concurrency: "unbounded" },
  )
  const titleMap = new Map(
    (plans?.data ?? [])
      .map((item) => record(item.plan))
      .filter((item): item is Record<string, unknown> => item !== undefined)
      .map((item) => [
        readNumber(item, ["id"]) ?? 0,
        {
          title: readString(item, ["title"]),
          subtitle: readString(item, ["subtitle"]),
        },
      ]),
  )

  return (subscription.data?.subscriptions ?? [])
    .map((item) => record(item.subscription))
    .filter((item): item is Record<string, unknown> => item !== undefined)
    .map((item) => {
      const planID = readNumber(item, ["plan_id"]) ?? 0
      return new Subscription({
        id: readNumber(item, ["id"]) ?? 0,
        plan_id: planID,
        title: titleMap.get(planID)?.title ?? `套餐 #${planID}`,
        subtitle: titleMap.get(planID)?.subtitle,
        status: readString(item, ["status"]) ?? "",
        amount_total: readNumber(item, ["amount_total"]) ?? 0,
        amount_used: readNumber(item, ["amount_used"]) ?? 0,
        end_time: readNumber(item, ["end_time"]) ?? 0,
        next_reset_time: readNumber(item, ["next_reset_time"]),
      })
    })
})

const fetchSubscriptionSelf = Effect.fn("MopcAccount.fetchSubscriptionSelf")(function* (session: MopcSession.Info) {
  const response = yield* fetchJson(`${session.api_base_url}/subscription/self`, session)
  const decoded = yield* Schema.decodeUnknownEffect(SubscriptionSelfResponse)(response).pipe(
    Effect.mapError((cause) => new Error({ message: "Invalid MOPC subscription response", cause })),
  )
  if (decoded.success === false) {
    return yield* Effect.fail(new Error({ message: decoded.message ?? "Failed to load MOPC subscriptions" }))
  }
  return decoded
})

const fetchSubscriptionPlans = Effect.fn("MopcAccount.fetchSubscriptionPlans")(function* (session: MopcSession.Info) {
  const response = yield* fetchJson(`${session.api_base_url}/subscription/plans`, session)
  const decoded = yield* Schema.decodeUnknownEffect(SubscriptionPlansResponse)(response).pipe(
    Effect.mapError((cause) => new Error({ message: "Invalid MOPC subscription plans response", cause })),
  )
  if (decoded.success === false) {
    return yield* Effect.fail(new Error({ message: decoded.message ?? "Failed to load MOPC subscription plans" }))
  }
  return decoded
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

const fetchJson = Effect.fn("MopcAccount.fetchJson")(function* (url: string, session: MopcSession.Info) {
  return yield* Effect.tryPromise({
    try: async () => {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${session.access_token}`,
          "New-API-User": String(session.user.id),
        },
      })
      const body = (await response.json().catch(() => null)) as { message?: string } | null
      if (!response.ok) throw new globalThis.Error(body?.message ?? `Request failed: ${response.status}`)
      return body
    },
    catch: (cause) => new Error({ message: `MOPC request failed: ${url}`, cause }),
  })
})
