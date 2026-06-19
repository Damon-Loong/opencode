export * as SkillV2 from "./skill"

import path from "path"
import { Context, Effect, Layer, Schema } from "effect"
import { castDraft } from "immer"
import { AgentV2 } from "./agent"
import { ConfigMarkdown } from "./config/markdown"
import { FSUtil } from "./fs-util"
import { PermissionV2 } from "./permission"
import { AbsolutePath, withStatics } from "./schema"
import { SkillDiscovery } from "./skill/discovery"
import { MopcSkill } from "./skill/mopc"
import { State } from "./state"

export class DirectorySource extends Schema.Class<DirectorySource>("SkillV2.DirectorySource")({
  type: Schema.Literal("directory"),
  path: AbsolutePath,
}) {}

export class UrlSource extends Schema.Class<UrlSource>("SkillV2.UrlSource")({
  type: Schema.Literal("url"),
  url: Schema.String,
}) {}

export class EmbeddedSource extends Schema.Class<EmbeddedSource>("SkillV2.EmbeddedSource")({
  type: Schema.Literal("embedded"),
  skill: Schema.suspend(() => Info),
}) {}

export class MopcSource extends Schema.Class<MopcSource>("SkillV2.MopcSource")({
  type: Schema.Literal("mopc"),
  path: AbsolutePath,
  skill_id: Schema.String,
  content_hash: Schema.String,
}) {}

export const Source = Schema.Union([DirectorySource, UrlSource, EmbeddedSource, MopcSource]).pipe(
  Schema.toTaggedUnion("type"),
  withStatics(() => ({
    equals: (a: DirectorySource | UrlSource | EmbeddedSource | MopcSource, b: Source) => {
      if (a.type !== b.type) return false
      if (a.type === "directory" && b.type === "directory") return a.path === b.path
      if (a.type === "url" && b.type === "url") return a.url === b.url
      if (a.type === "embedded" && b.type === "embedded") return a.skill.name === b.skill.name
      if (a.type === "mopc" && b.type === "mopc") return a.skill_id === b.skill_id && a.content_hash === b.content_hash
      return false
    },
    key: (source: DirectorySource | UrlSource | EmbeddedSource | MopcSource) =>
      source.type === "directory"
        ? `directory:${source.path}`
        : source.type === "url"
          ? `url:${source.url}`
          : source.type === "embedded"
            ? `embedded:${source.skill.name}`
            : `mopc:${source.skill_id}:${source.content_hash}`,
  })),
)
export type Source = typeof Source.Type

export class RemoteInfo extends Schema.Class<RemoteInfo>("SkillV2.RemoteInfo")({
  type: Schema.Literal("mopc"),
  skill_id: Schema.String,
  content_hash: Schema.String,
}) {}

export class Info extends Schema.Class<Info>("SkillV2.Info")({
  name: Schema.String,
  description: Schema.String.pipe(Schema.optional),
  slash: Schema.Boolean.pipe(Schema.optional),
  location: AbsolutePath,
  content: Schema.String,
  remote: RemoteInfo.pipe(Schema.optional),
}) {}

export const available = (skills: ReadonlyArray<Info>, agent: AgentV2.Info) =>
  skills.filter((skill) => PermissionV2.evaluate("skill", skill.name, agent.permissions).effect !== "deny")

const Frontmatter = Schema.Struct({
  name: Schema.String.pipe(Schema.optional),
  description: Schema.String.pipe(Schema.optional),
  slash: Schema.Boolean.pipe(Schema.optional),
})
const decodeFrontmatter = Schema.decodeUnknownOption(Frontmatter)

export type Data = {
  sources: Source[]
}

export type Editor = {
  source: (source: Source) => void
  list: () => readonly Source[]
}

export interface Interface {
  readonly transform: State.Interface<Data, Editor>["transform"]
  readonly sources: () => Effect.Effect<Source[]>
  readonly list: () => Effect.Effect<Info[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Skill") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const discovery = yield* SkillDiscovery.Service
    const fs = yield* FSUtil.Service

    const state = State.create<Data, Editor>({
      initial: () => ({ sources: [] }),
      editor: (draft) => ({
        source: (source) => {
          if (draft.sources.some((item) => Source.equals(item, source))) return
          draft.sources.push(castDraft(source))
        },
        list: () => draft.sources as Source[],
      }),
    })

    const load = Effect.fn("SkillV2.load")(function* (source: Source) {
      const skills: Info[] = []
      if (source.type === "embedded") return [source.skill]
      const directories =
        source.type === "directory"
          ? [source.path]
          : source.type === "mopc"
            ? [path.dirname(source.path)]
            : yield* discovery.pull(source.url)
      for (const directory of directories) {
        const files =
          source.type === "mopc"
            ? [source.path]
            : yield* fs
                .glob("{*.md,**/SKILL.md}", {
                  cwd: directory,
                  absolute: true,
                  include: "file",
                  symlink: true,
                  dot: true,
                })
                .pipe(Effect.catch(() => Effect.succeed([] as string[])))
        for (const filepath of files.toSorted()) {
          const content = yield* fs.readFileStringSafe(filepath).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (!content) continue
          const markdown = ConfigMarkdown.parseOption(content)
          if (!markdown) continue
          const frontmatter = decodeFrontmatter(markdown.data).valueOrUndefined
          if (!frontmatter) continue
          const name =
            frontmatter.name !== undefined
              ? frontmatter.name
              : path.dirname(filepath) === directory
                ? path.basename(filepath, ".md")
                : undefined
          if (!name) continue
          skills.push(
            new Info({
              name,
              description: frontmatter.description,
              slash: frontmatter.slash,
              location: AbsolutePath.make(filepath),
              content: markdown.content,
              remote:
                source.type === "mopc"
                  ? new RemoteInfo({
                      type: "mopc",
                      skill_id: source.skill_id,
                      content_hash: source.content_hash,
                    })
                  : undefined,
            }),
          )
        }
      }
      return skills
    })

    // QUESTION(Dax): Should local skill sources invalidate on filesystem watch
    // events, following the reload policy chosen for other context sources?
    const cache = new Map<string, Info[]>()
    const list = Effect.fn("SkillV2.list")(function* () {
      const skills = new Map<string, Info>()
      for (const source of state.get().sources) {
        const key = Source.key(source)
        const loaded = cache.get(key) ?? (yield* load(source))
        cache.set(key, loaded)
        for (const skill of loaded) skills.set(skill.name, skill)
      }
      return Array.from(skills.values())
    })

    return Service.of({
      transform: state.transform,
      sources: Effect.fn("SkillV2.sources")(function* () {
        return state.get().sources
      }),
      list,
    })
  }),
)

export const locationLayer = layer.pipe(Layer.provide(SkillDiscovery.defaultLayer))
