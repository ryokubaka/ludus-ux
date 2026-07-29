/**
 * Shared GOAD execute / surface helpers for the assistant tool executor.
 * Kept pure for unit tests.
 */

export function looksLikeGoadOp(operationId: string): boolean {
  return /goad/i.test(operationId)
}

export type ExecuteGoadArgsCheck =
  | { ok: true; args: string }
  | { ok: false; error: string; assistant_hint: string }

import { buildGoadWizardInstallArgs } from "@/lib/goad-wizard-args"

const EXAMPLE_ARGS = buildGoadWizardInstallArgs("GOAD-Mini", [])
const EXAMPLE_EXT = buildGoadWizardInstallArgs("GOAD-Mini", ["smoke-ci"])

/** Validate executeGoad body.args — must be one non-empty GOAD CLI string (not wizard JSON). */
export function checkExecuteGoadArgs(body: unknown): ExecuteGoadArgsCheck {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : undefined
  const raw = b?.args

  if (Array.isArray(raw)) {
    const joined = raw
      .map((x) => (typeof x === "string" ? x.trim() : String(x ?? "").trim()))
      .filter(Boolean)
      .join(" ")
    return {
      ok: false,
      error: "executeGoad body.args must be a single string, not an array.",
      assistant_hint:
        "Retry call_lux_api executeGoad with body.args as one CLI string" +
        (joined ? `, e.g. "${joined}"` : `, e.g. "${EXAMPLE_ARGS}"`) +
        ". Never pass a JSON array. Complete the goad-deploy.md ask_user wizard first if choices are missing.",
    }
  }

  const goadArgs = typeof raw === "string" ? raw.trim() : ""
  if (!goadArgs) {
    return {
      ok: false,
      error: "executeGoad requires body.args (GOAD CLI string). Fields like labName alone are invalid.",
      assistant_hint:
        `Use call_lux_api only. body.args must be one string, e.g. \`${EXAMPLE_ARGS}\`. ` +
        "With extensions use the --repl pattern from workflows/goad-deploy.md. " +
        "Also pass body.rangeId for the dedicated Ludus range. " +
        "Never stringify wizard answers (goadType/extensions/rangeID) as args.",
    }
  }

  // Model sometimes dumps ask_user answers as JSON into args — reject hard.
  if (goadArgs.startsWith("{") || goadArgs.startsWith("[")) {
    return {
      ok: false,
      error: "executeGoad body.args looks like JSON — GOAD expects a CLI string.",
      assistant_hint:
        `body.args must be a GOAD CLI string, not wizard JSON. Example no extensions: \`${EXAMPLE_ARGS}\`. ` +
        `Example with extensions: \`${EXAMPLE_EXT}\`. ` +
        "Pass body.rangeId = the Ludus rangeID from the wizard. Read workflows/goad-deploy.md args table.",
    }
  }

  // Also catch colon-dump forms: goadType:lux_goad extensions:[smoke-ci] rangeID:testgoad
  if (
    /goadType\s*:|["']goadType["']|"extensions"\s*:|rangeID\s*:|["']rangeID["']|extensions\s*:\s*\[/i.test(
      goadArgs,
    )
  ) {
    return {
      ok: false,
      error: "executeGoad body.args must not contain wizard field dumps (goadType/extensions/rangeID).",
      assistant_hint:
        `Build a real GOAD CLI string. No extensions: \`${EXAMPLE_ARGS}\`. ` +
        `With smoke-ci: \`${EXAMPLE_EXT}\`. ` +
        "rangeId goes in body.rangeId (separate field), not inside args.",
    }
  }

  if (!/(?:^|\s)-l\s+\S+/.test(goadArgs) && !/(?:^|\s)--repl\b/.test(goadArgs)) {
    return {
      ok: false,
      error: "executeGoad body.args must include `-l <LabName>` or `--repl \"…\"`.",
      assistant_hint:
        `Invalid args: "${goadArgs.slice(0, 120)}". ` +
        `Use \`${EXAMPLE_ARGS}\` (or --repl with set_lab / set_extensions per goad-deploy.md). ` +
        "Lab name must match catalog (e.g. GOAD-Mini).",
    }
  }

  // Never allow both forms — GOAD treats trailing --repl as unrecognized args.
  if (/(?:^|\s)-l\s+\S+/.test(goadArgs) && /(?:^|\s)--repl\b/.test(goadArgs)) {
    return {
      ok: false,
      error:
        "executeGoad body.args mixes `-l … -t install` with `--repl` — use exactly one form.",
      assistant_hint:
        `No extensions → \`${EXAMPLE_ARGS}\`. ` +
        `With extensions → ONLY \`${EXAMPLE_EXT}\` (no -l/-t install prefix). ` +
        "Pass body.rangeId separately.",
    }
  }

  return { ok: true, args: goadArgs }
}

export function unknownLudusOpHint(operationId: string, isTemplateAdd: boolean): string {
  if (isTemplateAdd) {
    return "That is not a Ludus operationId. Template add-from-source is LUX: list_lux_operations query=template → listTemplateSources → addTemplates via call_lux_api."
  }
  if (looksLikeGoadOp(operationId)) {
    return (
      `"${operationId}" is a LUX GOAD operation — use call_lux_api (not call_ludus_api). ` +
      "Read workflows/goad-deploy.md. executeGoad needs body.args as one CLI string + body.rangeId."
    )
  }
  return "That operationId does not exist. Call list_ludus_operations / list_lux_operations. Never invent operationIds."
}
