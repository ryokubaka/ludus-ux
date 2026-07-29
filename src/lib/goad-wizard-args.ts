/**
 * Canonical GOAD CLI args for LUX wizard deploys — same strings as /goad/new.
 * Assistant and UI must share this so executeGoad never gets wizard JSON dumps.
 */

export function shellQuoteGoadArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`
}

export type GoadWizardInstallMode =
  | { kind: "fresh" }
  | { kind: "existing"; instanceId: string; useDecomposedExtensionProvisioning: boolean }

/**
 * Single stdin `--repl` session: after `set_extensions` + workspace (`create_empty` or `use`),
 * with extensions we run `provide` → `prepare_jumpbox` → `provision_lab` → one
 * `provision_extension` per ext (one Ludus deploy). We avoid REPL `install`, which
 * would call `install_extension` per ext and re-run `ludus range deploy` each time.
 *
 * Re-use path: same decomposed tail only if instance.json extensions already match
 * the wizard (otherwise `install` so GOAD can `enable_extension` + deploy for new ext).
 */
export function buildGoadWizardInstallArgs(
  selectedLab: string,
  exts: string[],
  mode: GoadWizardInstallMode = { kind: "fresh" },
): string {
  const cleanExts = exts.map((e) => e.trim()).filter((e) => e && !/^none$/i.test(e))

  if (cleanExts.length === 0) {
    return mode.kind === "existing"
      ? `--repl "use ${shellQuoteGoadArg(mode.instanceId)};update_instance_files;install"`
      : `-l ${shellQuoteGoadArg(selectedLab)} -p ludus -m local -t install`
  }

  const extList = cleanExts.join(" ")
  const postWorkspaceInstall = [
    "provide",
    "prepare_jumpbox",
    "provision_lab",
    ...cleanExts.map((e) => `provision_extension ${e}`),
  ].join(";")

  if (mode.kind === "existing") {
    const head = `unload;use ${mode.instanceId};set_extensions ${extList};update_instance_files`
    const tail = mode.useDecomposedExtensionProvisioning ? postWorkspaceInstall : "install"
    return `--repl "${head};${tail}"`
  }

  const setup = [
    "unload",
    `set_lab ${selectedLab}`,
    "set_provider ludus",
    "set_provisioning_method local",
    `set_extensions ${extList}`,
    "create_empty",
  ].join(";")
  return `--repl "${setup};${postWorkspaceInstall}"`
}

/** Known GOAD lab names (longest first for matching). */
const KNOWN_LABS = [
  "GOAD-Mini",
  "GOAD-Light",
  "GOAD-Smoke",
  "GOAD",
  "NHA",
  "ADFS",
  "SCCM",
] as const

/**
 * Infer lab from chat text / ask titles (e.g. "Deploy GOAD-Mini range").
 * Prefers longest catalog-style name found.
 */
export function inferGoadLabName(...texts: Array<string | undefined | null>): string | null {
  const blob = texts.filter(Boolean).join("\n")
  if (!blob.trim()) return null
  const lower = blob.toLowerCase()
  let best: string | null = null
  for (const lab of KNOWN_LABS) {
    if (lower.includes(lab.toLowerCase())) {
      if (!best || lab.length > best.length) best = lab
    }
  }
  // goad_mini / goad-mini variants
  if (!best && /goad[\s_-]*mini/i.test(blob)) best = "GOAD-Mini"
  if (!best && /goad[\s_-]*smoke/i.test(blob)) best = "GOAD-Smoke"
  if (!best && /\bgoad\b/i.test(blob) && !/goad[\s_-]*mini|goad[\s_-]*smoke/i.test(blob)) best = "GOAD"
  return best
}

export type WizardAnswerSlice = {
  selected?: string[]
  text?: string
}

/** Extensions from wizard answers (drops None). */
export function extensionsFromWizardAnswer(ans?: WizardAnswerSlice): string[] {
  if (!ans?.selected?.length) return []
  return ans.selected.map((s) => s.trim()).filter((s) => s && !/^none$/i.test(s))
}

/**
 * Build executeGoad body fields from wizard answers + conversation text.
 * Returns null if lab or rangeId cannot be resolved.
 */
export function resolveExecuteGoadFromWizard(opts: {
  answers: Record<string, WizardAnswerSlice>
  /** User/assistant/ask titles for lab inference. */
  contextTexts?: string[]
  existingInstanceId?: string
}): { args: string; rangeId: string; lab: string; extensions: string[] } | null {
  const labFromAsk = opts.answers.lab?.selected?.[0]?.trim() || opts.answers.lab?.text?.trim()
  const lab =
    labFromAsk ||
    inferGoadLabName(...(opts.contextTexts || [])) ||
    null
  if (!lab) return null

  const rangeId =
    opts.answers.rangeID?.text?.trim() ||
    opts.answers.existingRangeId?.text?.trim() ||
    ""
  if (!rangeId) return null

  const extensions = extensionsFromWizardAnswer(opts.answers.extensions)
  const rangeMode = (opts.answers.range?.selected || []).map((s) => s.toLowerCase())
  const useExisting =
    !!opts.existingInstanceId ||
    rangeMode.some((s) => s === "existing" || s.includes("existing"))

  const args = useExisting && opts.existingInstanceId
    ? buildGoadWizardInstallArgs(lab, extensions, {
        kind: "existing",
        instanceId: opts.existingInstanceId,
        useDecomposedExtensionProvisioning: true,
      })
    : buildGoadWizardInstallArgs(lab, extensions, { kind: "fresh" })

  return { args, rangeId, lab, extensions }
}

/** True when args look like a wizard-answer dump instead of GOAD CLI. */
export function looksLikeWizardAnswerDump(args: string): boolean {
  const s = args.trim()
  if (!s) return true
  if (s.startsWith("{") || s.startsWith("[")) return true
  if (/goadType\s*:|rangeID\s*:|extensions\s*:\s*\[/i.test(s)) return true
  if (!/(?:^|\s)-l\s+\S+/.test(s) && !/(?:^|\s)--repl\b/.test(s)) return true
  return false
}

/**
 * Models often concatenate both install forms:
 * `-l 'GOAD-Mini' … -t install --repl "unload;set_lab…"`
 * GOAD argparse then fails with "unrecognized arguments: --repl …".
 */
export function looksLikeHybridGoadArgs(args: string): boolean {
  const s = args.trim()
  const hasL = /(?:^|\s)-l\s+\S+/.test(s)
  const hasRepl = /(?:^|\s)--repl\b/.test(s)
  return hasL && hasRepl
}

/** Keep only the `--repl "…"` portion when a hybrid string is detected. */
export function stripHybridGoadArgsToRepl(args: string): string | null {
  const s = args.trim()
  if (!looksLikeHybridGoadArgs(s)) return null
  const quoted = s.match(/--repl\s+("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/)
  if (quoted) return `--repl ${quoted[1]}`
  const unquoted = s.match(/--repl\s+(.+)$/)
  if (unquoted) {
    const rest = unquoted[1].trim().replace(/^["']|["']$/g, "")
    if (!rest) return null
    return `--repl "${rest}"`
  }
  return null
}

/** True when execute SSE/logs show GOAD CLI argparse failure. */
export function goadExecuteOutputLooksFailed(blob: string): boolean {
  return (
    /goad\.py:\s*error:/i.test(blob) ||
    /unrecognized arguments:/i.test(blob) ||
    /Instance dir creation error/i.test(blob)
  )
}
