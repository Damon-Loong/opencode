export * as MopcSkillPlugin from "./mopc"

import { Effect } from "effect"
import { PluginV2 } from "../../plugin"
import { AbsolutePath } from "../../schema"
import { SkillV2 } from "../../skill"
import { MopcSkill } from "../../skill/mopc"

export const Plugin = PluginV2.define({
  id: PluginV2.ID.make("mopc-skill"),
  effect: Effect.gen(function* () {
    const skill = yield* SkillV2.Service
    const transform = yield* skill.transform()
    const manifests = yield* MopcSkill.sync().pipe(Effect.catch(() => MopcSkill.manifests()))

    yield* transform((editor) => {
      for (const manifest of manifests) {
        editor.source(
          new SkillV2.MopcSource({
            type: "mopc",
            path: AbsolutePath.make(manifest.skill_md_path),
            skill_id: manifest.skill_id,
            content_hash: manifest.content_hash,
          }),
        )
      }
    })
  }),
})
