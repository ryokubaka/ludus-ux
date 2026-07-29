import fs from "fs"
import path from "path"

const SKILL_ROOT_CANDIDATES = [
  path.join(process.cwd(), "skills", "ludus-ux"),
  path.join(process.cwd(), "..", "skills", "ludus-ux"),
]

function resolveSkillRoot(): string | null {
  for (const p of SKILL_ROOT_CANDIDATES) {
    if (fs.existsSync(path.join(p, "SKILL.md"))) return p
  }
  return null
}

const FALLBACK = [
  "Reference: help operators manage Ludus ranges via Ludus + Ludus UX APIs.",
  "Docs first: search_documentation → read workflows/INDEX.md then the matching playbook.",
  "Prefer list → describe → call. LUX for GOAD/console/template-register; Ludus for range/deploy/ansible and Packer buildTemplates.",
  "GOAD-Mini → workflows/goad-deploy.md — never invent YAML or --dedicated. Ask when unsure.",
  "Underlying Ludus depth: search skills/ludus/ (range-config, ludus-cli, troubleshooting) — ludus-ux stays preferred for LUX flows.",
].join("\n")

/**
 * Load a *small* routing snippet for the system prompt.
 * Heavy docs (troubleshooting, WireGuard, full range-config) are NOT inlined —
 * they contaminate small models. Use search_documentation / fetch_ludus_doc instead.
 */
export function loadLudusUxSkillContext(maxChars = 8_500): string {
  const root = resolveSkillRoot()
  if (!root) return FALLBACK

  const parts: string[] = []
  const skillMd = fs.readFileSync(path.join(root, "SKILL.md"), "utf8")
  parts.push(skillMd)

  // Routing + workflow index first; full playbooks via search_documentation.
  const refs = [
    path.join("workflows", "INDEX.md"),
    "goad.md",
    "templates.md",
    "lux-vs-ludus.md",
  ]
  let used = skillMd.length
  for (const name of refs) {
    const fp = path.join(root, "references", name)
    if (!fs.existsSync(fp)) continue
    const body = fs.readFileSync(fp, "utf8")
    const label = name.replace(/\\/g, "/")
    if (used + body.length + 40 > maxChars) {
      const slice = body.slice(0, Math.max(0, maxChars - used - 80))
      if (slice.length > 80) parts.push(`\n\n---\n# ${label} (truncated)\n\n${slice}`)
      break
    }
    parts.push(`\n\n---\n# ${label}\n\n${body}`)
    used += body.length + 40
  }
  return parts.join("")
}

export function ludusUxSkillRootExists(): boolean {
  return resolveSkillRoot() != null
}
