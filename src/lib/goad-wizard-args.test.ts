import { describe, expect, it } from "vitest"
import {
  buildGoadWizardInstallArgs,
  goadExecuteOutputLooksFailed,
  inferGoadLabName,
  looksLikeHybridGoadArgs,
  looksLikeWizardAnswerDump,
  resolveExecuteGoadFromWizard,
  stripHybridGoadArgsToRepl,
} from "./goad-wizard-args"

describe("goad-wizard-args", () => {
  it("fresh no extensions → -l install", () => {
    expect(buildGoadWizardInstallArgs("GOAD-Mini", [])).toBe(
      "-l 'GOAD-Mini' -p ludus -m local -t install",
    )
  })

  it("fresh + smoke-ci matches LUX UI --repl form", () => {
    const args = buildGoadWizardInstallArgs("GOAD-Smoke", ["smoke-ci"])
    expect(args).toBe(
      '--repl "unload;set_lab GOAD-Smoke;set_provider ludus;set_provisioning_method local;set_extensions smoke-ci;create_empty;provide;prepare_jumpbox;provision_lab;provision_extension smoke-ci"',
    )
  })

  it("fresh + multiple extensions space-joins set_extensions and per-ext provision", () => {
    const args = buildGoadWizardInstallArgs("GOAD-Mini", ["smoke-ci", "elk"])
    expect(args).toContain("set_extensions smoke-ci elk")
    expect(args).toContain("provision_extension smoke-ci;provision_extension elk")
  })

  it("infers lab from deploy title text", () => {
    expect(inferGoadLabName("Deploy GOAD-Mini Range")).toBe("GOAD-Mini")
    expect(inferGoadLabName("GOAD-Smoke with smoke-ci")).toBe("GOAD-Smoke")
  })

  it("resolveExecuteGoadFromWizard builds args + rangeId", () => {
    const r = resolveExecuteGoadFromWizard({
      answers: {
        extensions: { selected: ["smoke-ci"] },
        range: { selected: ["new"] },
        rangeID: { text: "testgoad" },
      },
      contextTexts: ["Deploy a new GOAD-Mini range"],
    })
    expect(r).not.toBeNull()
    expect(r!.rangeId).toBe("testgoad")
    expect(r!.lab).toBe("GOAD-Mini")
    expect(r!.args).toContain("set_lab GOAD-Mini")
    expect(r!.args).toContain("set_extensions smoke-ci")
    expect(r!.args).toContain("provision_extension smoke-ci")
    expect(looksLikeWizardAnswerDump(r!.args)).toBe(false)
  })

  it("detects wizard JSON dump", () => {
    expect(
      looksLikeWizardAnswerDump(
        JSON.stringify({ goadType: "lux_goad", extensions: ["smoke-ci"], rangeID: "x" }),
      ),
    ).toBe(true)
    expect(looksLikeWizardAnswerDump("-l GOAD-Mini -p ludus -m local -t install")).toBe(false)
  })

  it("detects and strips hybrid -l + --repl args", () => {
    const hybrid =
      `-l 'GOAD-Mini' -p ludus -m local -t install --repl "unload;set_lab GOAD-Mini;set_extensions smoke-ci;create_empty;provide;prepare_jumpbox;provision_lab;provision_extension smoke-ci"`
    expect(looksLikeHybridGoadArgs(hybrid)).toBe(true)
    expect(stripHybridGoadArgsToRepl(hybrid)).toBe(
      `--repl "unload;set_lab GOAD-Mini;set_extensions smoke-ci;create_empty;provide;prepare_jumpbox;provision_lab;provision_extension smoke-ci"`,
    )
    expect(looksLikeHybridGoadArgs(`--repl "unload;set_lab GOAD-Mini;create_empty"`)).toBe(false)
    expect(
      goadExecuteOutputLooksFailed(
        "goad.py: error: unrecognized arguments: --repl unload;set_lab GOAD-Mini",
      ),
    ).toBe(true)
  })

  it("resolveExecuteGoadFromWizard uses existingRangeId", () => {
    const r = resolveExecuteGoadFromWizard({
      answers: {
        extensions: { selected: ["smoke-ci"] },
        range: { selected: ["existing"] },
        existingRangeId: { text: "catshadowstep" },
      },
      contextTexts: ["Deploy a new GOAD-Mini range"],
    })
    expect(r!.rangeId).toBe("catshadowstep")
    expect(r!.args.startsWith("--repl ")).toBe(true)
    expect(r!.args).not.toMatch(/-l\s+/)
  })
})
