import type { JSX } from "solid-js"
import { NEW_SESSION_CONTENT_WIDTH } from "@/pages/session/new-session-layout"

export function NewSessionDesignView(props: { children: JSX.Element }) {
  return (
    <div data-component="session-new-design" class="relative size-full overflow-hidden bg-v2-background-bg-deep ">
      <div class="absolute inset-x-0 top-[25.375%] flex justify-center px-6">
        <div class={NEW_SESSION_CONTENT_WIDTH}>
          <div
            aria-hidden
            class="w-full select-none text-center font-mono text-[88px] font-black uppercase leading-none tracking-[0.02em] text-v2-icon-icon-base opacity-[0.16]"
            style={{
              "mask-image": "linear-gradient(to bottom, rgb(255 255 255 / 0.7), rgb(255 255 255 / 0))",
              "-webkit-mask-image": "linear-gradient(to bottom, rgb(255 255 255 / 0.7), rgb(255 255 255 / 0))",
            }}
          >
            MBM CODE
          </div>
          <div class="mt-8">{props.children}</div>
        </div>
      </div>
    </div>
  )
}
