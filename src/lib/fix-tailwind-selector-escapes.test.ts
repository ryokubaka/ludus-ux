import { createRequire } from "node:module"
import { describe, expect, it } from "vitest"

const { fixTailwindSelectorEscapes } = createRequire(import.meta.url)(
  "../../scripts/fix-tailwind-selector-escapes.cjs",
) as { fixTailwindSelectorEscapes: (css: string) => string }

describe("fixTailwindSelectorEscapes", () => {
  it("collapses the extra backslashes production minify adds to variant selectors", () => {
    const broken = ".hover\\\\\\:bg-sidebar-accent:hover{background-color:red}.data-\\\\\\[state\\\\\\=active\\\\\\]\\\\\\:bg-background[data-state=active]{color:blue}"
    const fixed = fixTailwindSelectorEscapes(broken)
    expect(fixed).toBe(
      ".hover\\:bg-sidebar-accent:hover{background-color:red}.data-\\[state\\=active\\]\\:bg-background[data-state=active]{color:blue}",
    )
  })

  it("leaves a correctly escaped selector and a content escape alone", () => {
    const css = ".hover\\:bg-accent:hover{background:red}.x::before{content:\"\\a0\"}"
    expect(fixTailwindSelectorEscapes(css)).toBe(css)
  })
})
