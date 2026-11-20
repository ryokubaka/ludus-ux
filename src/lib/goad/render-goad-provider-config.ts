import { isGoadCatalogName } from "@/lib/goad/goad-wizard-args"
import { stripRangeIdHostnames } from "@/lib/range/hostname-range-id"
import { GOAD_PREVIEW_CONFIG_PY } from "@/lib/goad/goad-preview-config-py"
import { sshExec, type SSHCreds } from "@/lib/goad/goad-ssh"
import { resolveGoadPath } from "@/lib/core/runtime-paths"

/**
 * Render the Ludus range config for a lab and its extensions from the GOAD
 * checkout (`ad/<lab>/providers/ludus/config.yml`, then each extension, wrapped
 * by `template/provider/ludus/config.yml`). Nothing is written on the host.
 *
 * `rangeId` stays the literal `{{ range_id }}` unless the caller already knows
 * the value Ludus should store. Ludus fills that placeholder in at config set.
 */
export async function renderGoadProviderConfig(opts: {
  lab: string
  extensions: readonly string[]
  provider?: string
  ipRange?: string
  rangeId?: string
  creds?: SSHCreds
}): Promise<string> {
  const labName = opts.lab.trim()
  const providerName = (opts.provider || "ludus").trim() || "ludus"
  if (!isGoadCatalogName(labName) || !isGoadCatalogName(providerName)) {
    throw new Error("That lab is not a GOAD catalog name.")
  }
  const extensions = opts.extensions.map((name) => name.trim()).filter(Boolean)
  if (!extensions.every((name) => isGoadCatalogName(name))) {
    throw new Error("That extension is not a GOAD catalog name.")
  }
  const goadPath = resolveGoadPath()
  if (!goadPath) throw new Error("GOAD path is not set.")

  const ipRange = (opts.ipRange || "").trim() || "192.168.56"
  const rangeId = (opts.rangeId || "").trim() || "{{ range_id }}"
  const b64 = (value: string) => Buffer.from(value, "utf-8").toString("base64")
  const encoded = Buffer.from(GOAD_PREVIEW_CONFIG_PY, "utf-8").toString("base64")
  const cmd = `echo '${encoded}' | base64 -d | python3 - '${b64(goadPath)}' '${b64(labName)}' '${b64(JSON.stringify(extensions))}' '${b64(providerName)}' '${b64(ipRange)}' '${b64(rangeId)}'`

  const { stdout, stderr, code } = await sshExec(cmd, opts.creds)
  if (code !== 0) {
    throw new Error(`Could not read the GOAD lab configuration (exit ${code}): ${(stderr || stdout).slice(0, 500)}`)
  }
  const line = stdout.trim().split("\n").filter(Boolean).pop() ?? "{}"
  let parsed: { ok?: boolean; yaml?: string; error?: string }
  try {
    parsed = JSON.parse(line) as { ok?: boolean; yaml?: string; error?: string }
  } catch {
    throw new Error("GOAD did not return a lab configuration.")
  }
  if (!parsed.ok || !parsed.yaml?.trim()) {
    throw new Error(parsed.error || "GOAD did not return a lab configuration.")
  }
  return stripRangeIdHostnames(parsed.yaml)
}
