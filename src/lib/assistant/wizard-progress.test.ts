import { describe, expect, it } from "vitest"
import { formatAllAskAnswersForModel, type AskQuestion } from "./ask-user"
import {
  answeredAskRow,
  assertAskUserAllowed,
  assertWizardAllowsGoadDeploy,
  deriveWizardProgress,
  wizardAnswersHistoryContent,
} from "./wizard-progress"

const pathQ: AskQuestion = {
  id: "path",
  prompt: "Deploy via?",
  type: "single",
  options: [
    { id: "lux_goad", label: "LUX GOAD" },
    { id: "ludus_blueprint", label: "Blueprint" },
  ],
}

const extQ: AskQuestion = {
  id: "extensions",
  prompt: "Extensions?",
  type: "multi",
  options: [
    { id: "none", label: "None" },
    { id: "elk", label: "elk" },
  ],
}

const rangeQ: AskQuestion = {
  id: "range",
  prompt: "Range?",
  type: "single",
  options: [
    { id: "new", label: "New Range" },
    { id: "existing", label: "Existing Range" },
  ],
}

describe("wizard-progress", () => {
  it("after path+extensions+range=new → nextStep is rangeID", () => {
    const rows = [
      answeredAskRow("path", [pathQ], { path: { selected: ["lux_goad"] } }),
      answeredAskRow("ext", [extQ], { extensions: { selected: ["none"] } }),
      answeredAskRow("range", [rangeQ], { range: { selected: ["new"] } }),
    ]
    const p = deriveWizardProgress(rows)
    expect(p.flow).toBe("goad_lux")
    expect(p.nextStep).toBe("rangeID")
    expect(p.nextAskHint).toMatch(/rangeID/)
  })

  it("allows ask_user for existingRangeId when range=existing", () => {
    const rows = [
      answeredAskRow("path", [pathQ], { path: { selected: ["lux_goad"] } }),
      answeredAskRow("ext", [extQ], { extensions: { selected: ["none"] } }),
      answeredAskRow("range", [rangeQ], { range: { selected: ["existing"] } }),
    ]
    const progress = deriveWizardProgress(rows)
    expect(progress.nextStep).toBe("existingRangeId")
    const gate = assertAskUserAllowed(
      {
        title: "Existing range",
        questions: [
          {
            id: "existingRangeId",
            prompt: "Existing Ludus range ID",
            type: "text",
            required: true,
          },
        ],
      },
      progress,
    )
    expect(gate.ok).toBe(true)
  })

  it("rejects ask_user for extensions when next is rangeID", () => {
    const rows = [
      answeredAskRow("path", [pathQ], { path: { selected: ["lux_goad"] } }),
      answeredAskRow("ext", [extQ], { extensions: { selected: ["smoke-ci"] } }),
      answeredAskRow("range", [rangeQ], { range: { selected: ["new"] } }),
    ]
    const progress = deriveWizardProgress(rows)
    const gate = assertAskUserAllowed(
      {
        title: "Select Extensions",
        questions: [extQ],
      },
      progress,
    )
    expect(gate.ok).toBe(false)
    if (gate.ok) return
    expect(gate.error).toMatch(/rangeID/)
    expect(gate.assistant_hint).toMatch(/rangeID/)
  })

  it("allows ask_user for rangeID when that is next", () => {
    const rows = [
      answeredAskRow("path", [pathQ], { path: { selected: ["lux_goad"] } }),
      answeredAskRow("ext", [extQ], { extensions: { selected: ["none"] } }),
      answeredAskRow("range", [rangeQ], { range: { selected: ["new"] } }),
    ]
    const progress = deriveWizardProgress(rows)
    const gate = assertAskUserAllowed(
      {
        title: "New range name",
        questions: [
          {
            id: "rangeID",
            prompt: "New rangeID",
            type: "text",
            required: true,
          },
        ],
      },
      progress,
    )
    expect(gate.ok).toBe(true)
  })

  it("allows bundled extensions+range+network when next is extensions", () => {
    const rows = [answeredAskRow("path", [pathQ], { path: { selected: ["lux_goad"] } })]
    const progress = deriveWizardProgress(rows)
    expect(progress.nextStep).toBe("extensions")
    const netQ: AskQuestion = {
      id: "network",
      prompt: "Network?",
      type: "single",
      options: [
        { id: "skip", label: "Skip" },
        { id: "custom", label: "Custom" },
      ],
    }
    const gate = assertAskUserAllowed(
      {
        title: "Deploy GOAD",
        questions: [extQ, rangeQ, netQ],
      },
      progress,
    )
    expect(gate.ok).toBe(true)
  })

  it("rejects re-bundling already-answered extensions with range", () => {
    const rows = [
      answeredAskRow("path", [pathQ], { path: { selected: ["lux_goad"] } }),
      answeredAskRow("ext", [extQ], { extensions: { selected: ["none"] } }),
    ]
    const progress = deriveWizardProgress(rows)
    expect(progress.nextStep).toBe("range")
    const gate = assertAskUserAllowed(
      {
        title: "bad bundle",
        questions: [extQ, rangeQ],
      },
      progress,
    )
    expect(gate.ok).toBe(false)
  })

  it("formatAllAskAnswersForModel + history content include all cards", () => {
    const rows = [
      answeredAskRow("path", [pathQ], { path: { selected: ["lux_goad"] } }),
      answeredAskRow("ext", [extQ], { extensions: { selected: ["none"] } }),
      answeredAskRow("range", [rangeQ], { range: { selected: ["new"] } }),
    ]
    const all = formatAllAskAnswersForModel(rows)
    expect(all).toMatch(/lux_goad/)
    expect(all).toMatch(/extensions/)
    expect(all).toMatch(/range/)
    const hist = wizardAnswersHistoryContent(rows)
    expect(hist).toMatch(/do NOT re-ask/)
    expect(hist).toMatch(/lux_goad/)
  })

  it("after extensions only → next is range", () => {
    const rows = [
      answeredAskRow("path", [pathQ], { path: { selected: ["lux_goad"] } }),
      answeredAskRow("ext", [extQ], { extensions: { selected: ["none"] } }),
    ]
    expect(deriveWizardProgress(rows).nextStep).toBe("range")
  })

  it("maps goadType answer to path and path=new answer to range", () => {
    const goadTypeQ: AskQuestion = {
      id: "goadType",
      prompt: "method",
      type: "single",
      options: [
        { id: "lux_goad", label: "LUX" },
        { id: "ludus_blueprint", label: "BP" },
      ],
    }
    const pathAsRangeQ: AskQuestion = {
      id: "path",
      prompt: "range?",
      type: "single",
      options: [
        { id: "new", label: "New" },
        { id: "existing", label: "Existing" },
      ],
    }
    const rows = [
      answeredAskRow("type", [goadTypeQ], { goadType: { selected: ["lux_goad"] } }),
      answeredAskRow("ext", [extQ], { extensions: { selected: ["none"] } }),
      answeredAskRow("rng", [pathAsRangeQ], { path: { selected: ["new"] } }),
    ]
    const p = deriveWizardProgress(rows)
    expect(p.flow).toBe("goad_lux")
    expect(p.answeredIds).toContain("path")
    expect(p.answeredIds).toContain("range")
    expect(p.nextStep).toBe("rangeID")
  })

  it("blocks deploy until confirm=deploy", () => {
    const rows = [
      answeredAskRow("path", [pathQ], { path: { selected: ["lux_goad"] } }),
      answeredAskRow("ext", [extQ], { extensions: { selected: ["none"] } }),
      answeredAskRow("range", [rangeQ], { range: { selected: ["new"] } }),
    ]
    const blocked = assertWizardAllowsGoadDeploy(rows)
    expect(blocked.ok).toBe(false)
  })

  it("range deploy path=new → next method", () => {
    const rangePath: AskQuestion = {
      id: "path",
      prompt: "Range action?",
      type: "single",
      options: [
        { id: "new", label: "New" },
        { id: "existing", label: "Existing" },
      ],
    }
    const rows = [answeredAskRow("Range deploy", [rangePath], { path: { selected: ["new"] } })]
    const p = deriveWizardProgress(rows)
    expect(p.flow).toBe("range_deploy")
    expect(p.nextStep).toBe("method")
  })
})
