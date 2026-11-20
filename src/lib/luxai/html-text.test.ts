import { describe, expect, it } from "vitest"
import { htmlToText } from "@/lib/luxai/html-text"

describe("htmlToText", () => {
  it("drops a script whose end tag has space before the bracket", () => {
    const text = htmlToText("<p>before</p><script>alert(1)</script ><p>after</p>")
    expect(text).toBe("before after")
    expect(text).not.toContain("alert")
    expect(htmlToText("<STYLE>body{}</STYLE><p>kept</p>")).toBe("kept")
  })

  it("decodes &amp; once", () => {
    expect(htmlToText("&amp;lt;script&amp;gt;")).toBe("&lt;script&gt;")
    expect(htmlToText("a&nbsp;b")).toBe("a b")
  })
})
