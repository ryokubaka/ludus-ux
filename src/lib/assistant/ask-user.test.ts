import { describe, expect, it } from "vitest"
import {
  formatAllAskAnswersForModel,
  formatAskAnswersForModel,
  parseAskPrompt,
  validateAskAnswers,
  mergeExtensionCatalogOptions,
  extensionsOptionsNeedCatalog,
} from "./ask-user"
describe("ask-user", () => {
  it("parses single-choice questions", () => {
    const r = parseAskPrompt({
      title: "GOAD deploy",
      questions: [
        {
          id: "ext",
          prompt: "Extensions?",
          type: "single",
          options: [
            { id: "none", label: "None" },
            { id: "exchange", label: "Exchange" },
          ],
        },
      ],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.prompt.questions[0].options).toHaveLength(2)
  })

  it("rejects choice questions without options", () => {
    const r = parseAskPrompt({
      title: "x",
      questions: [{ id: "a", prompt: "Pick", type: "single" }],
    })
    expect(r.ok).toBe(false)
  })

  it("validates required answers", () => {
    const parsed = parseAskPrompt({
      title: "GOAD",
      questions: [
        {
          id: "mode",
          prompt: "New or existing?",
          type: "single",
          options: [
            { id: "new", label: "New" },
            { id: "existing", label: "Existing" },
          ],
        },
      ],
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    // new|existing single cards normalize to id=range
    expect(parsed.prompt.questions[0].id).toBe("range")
    expect(validateAskAnswers(parsed.prompt, {}).ok).toBe(false)
    const ok = validateAskAnswers(parsed.prompt, { range: { selected: ["new"] } })
    expect(ok.ok).toBe(true)
    if (!ok.ok) return
    expect(formatAskAnswersForModel(parsed.prompt, ok.answers)).toMatch(/New \(new\)/)
  })

  it("injects None first for extension questions and keeps it when capping", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      id: `ext${i}`,
      label: `ext${i}`,
    }))
    const r = parseAskPrompt({
      title: "Select Extensions for GOAD-Mini Range",
      questions: [
        {
          id: "extensions",
          prompt: "Choose any extensions to include in the range",
          type: "multi",
          options: many,
        },
      ],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const opts = r.prompt.questions[0].options || []
    expect(opts[0]).toEqual({ id: "none", label: "None" })
    expect(opts.length).toBeLessThanOrEqual(40)
    expect(opts.some((o) => o.id === "none")).toBe(true)
  })

  it("formatAllAskAnswersForModel concatenates answered ask rows", () => {
    const a = formatAllAskAnswersForModel([
      {
        kind: "ask",
        title: "Path",
        resolved: "answered",
        questions: [
          {
            id: "path",
            prompt: "Path?",
            type: "single",
            options: [{ id: "lux_goad", label: "LUX" }],
          },
        ],
        answers: { path: { selected: ["lux_goad"] } },
      },
      {
        kind: "ask",
        title: "Ext",
        resolved: "answered",
        questions: [
          {
            id: "extensions",
            prompt: "Ext?",
            type: "multi",
            options: [{ id: "none", label: "None" }],
          },
        ],
        answers: { extensions: { selected: ["none"] } },
      },
      { kind: "user", title: "ignore" },
    ])
    expect(a).toMatch(/Path/)
    expect(a).toMatch(/lux_goad/)
    expect(a).toMatch(/extensions/)
    expect(a).toMatch(/none/)
  })

  it("rewrites confusing 'path for the new range' text into rangeID", () => {
    const r = parseAskPrompt({
      title: "Deploy GOAD-Mini Range",
      questions: [
        {
          id: "path",
          prompt: "What is the path for the new range?",
          type: "text",
        },
      ],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.prompt.questions[0].id).toBe("rangeID")
    expect(r.prompt.questions[0].prompt).toMatch(/Ludus range ID/i)
    expect(r.prompt.questions[0].prompt).not.toMatch(/^What is the path/i)
  })

  it("maps goadType lux/blueprint options to id=path", () => {
    const r = parseAskPrompt({
      title: "Deploy",
      questions: [
        {
          id: "goadType",
          prompt: "Select the deployment method",
          type: "single",
          options: [
            { id: "lux_goad", label: "LUX" },
            { id: "ludus_blueprint", label: "Blueprint" },
          ],
        },
      ],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.prompt.questions[0].id).toBe("path")
  })

  it("maps new|existing mislabeled as path → range", () => {
    const r = parseAskPrompt({
      title: "Deploy",
      questions: [
        {
          id: "path",
          prompt: "Select the deployment method",
          type: "single",
          options: [
            { id: "new", label: "New Range" },
            { id: "existing", label: "Existing Range" },
          ],
        },
      ],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.prompt.questions[0].id).toBe("range")
    expect(r.prompt.questions[0].prompt).toMatch(/dedicated Ludus range/i)
  })

  it("does not rewrite confirm cards that mention Extensions in the summary", () => {
    const r = parseAskPrompt({
      title: "Confirm GOAD-Mini Range Deployment",
      questions: [
        {
          id: "confirm",
          prompt:
            "Do you want to proceed with the deployment? Extensions: smoke-ci. Range ID: testgoad.",
          type: "single",
          options: [
            { id: "deploy", label: "Deploy" },
            { id: "cancel", label: "Cancel" },
          ],
        },
      ],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.prompt.questions[0].id).toBe("confirm")
  })

  it("preserves existingRangeId text asks (does not rewrite to rangeID)", () => {
    const r = parseAskPrompt({
      title: "Deploy GOAD-Mini Range",
      questions: [
        {
          id: "existingRangeId",
          prompt: "Please provide the existing Ludus range ID you want to use for the deployment:",
          type: "text",
          required: true,
        },
      ],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.prompt.questions[0].id).toBe("existingRangeId")
    expect(r.prompt.title).toMatch(/Existing/i)
  })

  it("mergeExtensionCatalogOptions fills names after None", () => {
    const opts = mergeExtensionCatalogOptions(
      [
        { id: "none", label: "None" },
        { id: "smoke-ci", label: "Smoke CI" },
        { id: "other-extension-1", label: "Other Extension 1" },
      ],
      ["elk", "exchange", "smoke-ci", "none"],
    )
    expect(opts[0]).toEqual({ id: "none", label: "None" })
    expect(opts.map((o) => o.id)).toEqual(["none", "elk", "exchange", "smoke-ci"])
    expect(opts.find((o) => o.id === "smoke-ci")?.label).toBe("Smoke CI")
    expect(opts.map((o) => o.id)).not.toContain("other-extension-1")
    expect(extensionsOptionsNeedCatalog([{ id: "none", label: "None" }])).toBe(true)
    expect(
      extensionsOptionsNeedCatalog(
        [
          { id: "none", label: "None" },
          { id: "smoke-ci", label: "Smoke CI" },
        ],
        17,
      ),
    ).toBe(true)
    expect(extensionsOptionsNeedCatalog(opts, 3)).toBe(false)
    // Without catalogSize, tiny subsets look incomplete (< 5 non-None).
    expect(extensionsOptionsNeedCatalog(opts)).toBe(true)
  })
})
