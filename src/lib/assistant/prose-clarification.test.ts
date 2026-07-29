import { describe, expect, it } from "vitest"
import { looksLikeProseClarification } from "./prose-clarification"

describe("looksLikeProseClarification", () => {
  it("flags the gpt-4o-mini style GOAD prose ask", () => {
    const text = `To deploy a new GOAD-Mini range, I need to confirm a few details with you.

1. **Extensions**: Do you want to include any specific extensions?
2. **Range Name**: What would you like to name the new range?
3. **Network Configuration**: Do you want to skip the network configuration or customize it?

Please provide your preferences for these options.`
    expect(looksLikeProseClarification(text)).toBe(true)
  })

  it("ignores normal status answers", () => {
    expect(
      looksLikeProseClarification(
        "GOAD-Mini templates are ready (win2019-server-x64-template is built). Open /goad when you want the UI wizard.",
      ),
    ).toBe(false)
  })

  it("ignores empty / tiny", () => {
    expect(looksLikeProseClarification("")).toBe(false)
    expect(looksLikeProseClarification("OK")).toBe(false)
  })
})
