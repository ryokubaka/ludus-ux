import { describe, expect, it } from "vitest"
import { formatAssistantSessionForCopy } from "./session-copy"

describe("session-copy", () => {
  it("formats user/assistant/ask/tool rows", () => {
    const text = formatAssistantSessionForCopy({
      title: "GOAD test",
      conversationId: "ac_1",
      rows: [
        { kind: "user", text: "Deploy GOAD-Mini" },
        {
          kind: "ask",
          title: "Path",
          questions: [
            {
              id: "path",
              prompt: "Deploy via?",
              type: "single",
              options: [{ id: "lux_goad", label: "LUX" }],
            },
          ],
          resolved: "answered",
          answers: { path: { selected: ["lux_goad"] } },
        },
        { kind: "tool", name: "ask_user", detail: '{"ok":true}' },
        { kind: "assistant", text: "Done" },
      ],
      exportedAt: new Date("2026-07-29T00:00:00.000Z"),
    })
    expect(text).toMatch(/LUX Assistant session/)
    expect(text).toMatch(/GOAD test/)
    expect(text).toMatch(/Deploy GOAD-Mini/)
    expect(text).toMatch(/path: lux_goad/)
    expect(text).toMatch(/Tool: ask_user/)
    expect(text).toMatch(/Exported: 2026-07-29/)
  })
})
