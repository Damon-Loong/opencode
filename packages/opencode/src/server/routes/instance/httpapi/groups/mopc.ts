import { MopcAccount } from "@opencode-ai/core/mopc/account"
import { MopcSession } from "@opencode-ai/core/mopc/session"
import { MopcStore } from "@opencode-ai/core/mopc/store"
import { MopcTool } from "@opencode-ai/core/mopc/tool"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { described } from "./metadata"

export const MopcApi = HttpApi.make("mopc").add(
  HttpApiGroup.make("mopc")
    .add(
      HttpApiEndpoint.get("sessionGet", "/api/mopc/session", {
        success: described(Schema.NullOr(MopcSession.PublicInfo), "Current MOPC session"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "mopc.session.get",
          summary: "Get MOPC session",
          description: "Get the current MOPC session without secrets.",
        }),
      ),
      HttpApiEndpoint.put("sessionSet", "/api/mopc/session", {
        payload: MopcSession.SetInput,
        success: described(MopcSession.PublicInfo, "Saved MOPC session"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "mopc.session.set",
          summary: "Set MOPC session",
          description: "Save MOPC session and sync remote skills.",
        }),
      ),
      HttpApiEndpoint.delete("sessionClear", "/api/mopc/session", {
        success: HttpApiSchema.NoContent,
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "mopc.session.clear",
          summary: "Clear MOPC session",
          description: "Clear MOPC session and MBM auth.",
        }),
      ),
      HttpApiEndpoint.post("sessionSync", "/api/mopc/session/sync", {
        success: HttpApiSchema.NoContent,
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "mopc.session.sync",
          summary: "Sync MOPC skills",
          description: "Sync remote MOPC skills using the stored session.",
        }),
      ),
      HttpApiEndpoint.get("accountGet", "/api/mopc/account", {
        success: described(Schema.NullOr(MopcAccount.Info), "Current MOPC account summary"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "mopc.account.get",
          summary: "Get MOPC account",
          description: "Get the current MOPC account summary without secrets.",
        }),
      ),
      HttpApiEndpoint.get("subscriptionsList", "/api/mopc/subscriptions", {
        success: described(Schema.Array(MopcAccount.Subscription), "Current MOPC subscriptions"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "mopc.subscriptions.list",
          summary: "List MOPC subscriptions",
          description: "List active MOPC subscriptions with plan display information.",
        }),
      ),
      HttpApiEndpoint.get("toolsList", "/api/mopc/tools", {
        success: described(Schema.Array(MopcTool.PublicDefinition), "Remote MOPC tools"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "mopc.tools.list",
          summary: "List MOPC tools",
          description: "List cached remote MOPC tools from the stored session.",
        }),
      ),
      HttpApiEndpoint.put("toolSetEnabled", "/api/mopc/tools/:tool_id/enabled", {
        params: { tool_id: Schema.String },
        payload: Schema.Struct({ enabled: Schema.Boolean }),
        success: described(MopcTool.Settings, "MOPC tool settings"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "mopc.tools.setEnabled",
          summary: "Enable MOPC tool",
          description: "Enable or disable a remote MOPC tool locally.",
        }),
      ),
      HttpApiEndpoint.get("storeSkillsList", "/api/mopc/store/skills", {
        success: described(Schema.Array(MopcStore.Skill), "MOPC store skills"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "mopc.store.skills.list",
          summary: "List MOPC store skills",
          description: "List public MOPC skills available to acquire.",
        }),
      ),
      HttpApiEndpoint.post("storeSkillAcquire", "/api/mopc/store/skills/:skill_id/acquire", {
        params: { skill_id: Schema.NumberFromString },
        success: HttpApiSchema.NoContent,
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "mopc.store.skills.acquire",
          summary: "Acquire MOPC store skill",
          description: "Acquire a public MOPC skill for the stored session user.",
        }),
      ),
      HttpApiEndpoint.get("storeToolsList", "/api/mopc/store/tools", {
        success: described(Schema.Array(MopcStore.Tool), "MOPC store tools"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "mopc.store.tools.list",
          summary: "List MOPC store tools",
          description: "List public MOPC tools available to install.",
        }),
      ),
      HttpApiEndpoint.post("storeToolInstall", "/api/mopc/store/tools/:tool_id/install", {
        params: { tool_id: Schema.String },
        success: HttpApiSchema.NoContent,
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "mopc.store.tools.install",
          summary: "Install MOPC store tool",
          description: "Install a public MOPC tool for the stored session user.",
        }),
      ),
    )
    .annotateMerge(OpenApi.annotations({ title: "mopc", description: "MOPC session routes." })),
)
