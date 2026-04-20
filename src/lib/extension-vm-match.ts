import type { VMObject } from "@/lib/types"

function vmShortName(name: string): string {
  return (name.split(".")[0] || name).trim().toLowerCase()
}

/**
 * Normalise `machines` into a flat array of non-empty lowercase strings.
 *
 * The catalog's `machines` field comes from an SSH-discovered `extension.json`:
 * most extensions declare it as `string[]` but we've seen older configs use
 * `{ [hostname]: { ... } }`-style objects, `{ name: "..." }` entries, or omit
 * the field entirely (falling back to `lab.hosts` keys on the Python side).
 * Anything we can't turn into a string is dropped rather than throwing.
 */
function normalizeMachines(input: unknown): string[] {
  const out: string[] = []
  const push = (s: unknown) => {
    if (typeof s === "string") {
      const t = s.trim()
      if (t) out.push(t)
    }
  }
  if (Array.isArray(input)) {
    for (const m of input) {
      if (typeof m === "string") push(m)
      else if (m && typeof m === "object") {
        const rec = m as Record<string, unknown>
        push(rec.name)
        push(rec.hostname)
      }
    }
  } else if (input && typeof input === "object") {
    for (const k of Object.keys(input as Record<string, unknown>)) push(k)
  }
  return out
}

/**
 * Resolve the set of Ludus VM IDs to destroy for a GOAD extension.
 *
 * Matching strategy (in order of specificity):
 *
 *   1. Each entry in the catalog's `machines` is compared against every VM
 *      name using a ladder of checks: exact match, short-name match (strips
 *      FQDN suffix from both sides), pool-suffix `-<host>`, and substring
 *      fallback. FQDN entries are reduced to their short form so entries like
 *      `ws02.essos.local` still match a Proxmox-pooled VM called
 *      `<user>-<range>-GOAD-ws02`.
 *
 *   2. The extension slug (e.g. `ws02`) is ALWAYS also tried as a substring
 *      fallback. Historically this was gated on `machines.length === 0`,
 *      which broke GOAD extensions whose `extension.json` lists machine
 *      hostnames that don't align with the actual vm_name in the generated
 *      Ludus range-config (we saw this with `ws02` where `machines` contained
 *      unrelated entries and the slug fallback was silently skipped). Running
 *      the slug check unconditionally gives us a safety net without any loss
 *      of precision — the `>= 3` length floor + restrictive substring check
 *      means a 2-char extension name can't accidentally match everything.
 *
 * On a zero-match result we emit a `console.warn` dump of what was tried so
 * operators can diagnose broken catalog definitions without adding temporary
 * `console.log`s every time.
 */
export function matchingVmIdsForExtension(
  extensionName: string,
  catalogMachines: unknown,
  vms: VMObject[],
): number[] {
  const ids = new Set<number>()
  const slug = (extensionName || "").trim().toLowerCase()
  const machines = normalizeMachines(catalogMachines)

  for (const vm of vms) {
    const raw = (vm.name || "").trim()
    if (!raw) continue
    const nLow = raw.toLowerCase()
    const short = vmShortName(raw)
    let matched = false

    for (const m of machines) {
      const ml = m.toLowerCase()
      if (!ml) continue
      const mShort = vmShortName(m)
      if (
        raw === m ||
        nLow === ml ||
        short === ml ||
        short === mShort ||
        raw.endsWith(`.${m}`) ||
        nLow.endsWith(`-${ml}`) ||
        nLow.endsWith(`-${mShort}`) ||
        nLow.includes(ml) ||
        (mShort.length >= 3 && nLow.includes(mShort))
      ) {
        matched = true
        break
      }
    }

    // Always try the extension slug as a substring fallback. Covers both
    // `machines: []` catalogs and catalogs whose machine entries don't align
    // with Ludus' actual vm_name (e.g. a catalog says `["windows"]` but the
    // pool-prefixed Proxmox name is `<user>-<range>-GOAD-ws02`).
    if (!matched && slug.length >= 3 && (nLow.includes(slug) || short.includes(slug))) {
      matched = true
    }

    if (matched) {
      const id = vm.proxmoxID ?? vm.ID
      if (id != null && !Number.isNaN(Number(id))) ids.add(Number(id))
    }
  }

  if (ids.size === 0 && vms.length > 0) {
    // eslint-disable-next-line no-console
    console.warn("[LUX] matchingVmIdsForExtension: no VMs matched", {
      extensionName,
      slug,
      machines,
      vmNames: vms.map((v) => v.name),
    })
  }

  return [...ids]
}
