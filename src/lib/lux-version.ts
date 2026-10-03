/** First LUX release that ships in-app version checks and upgrades. */
export const LUX_VERSION_MANAGEMENT_SINCE = "1.4.0"

/** Strict release tags only — no branches, suffixes, or shell metacharacters. */
export const LUX_RELEASE_TAG_RE = /^v(\d+)\.(\d+)\.(\d+)$/

export type LuxSemver = { major: number; minor: number; patch: number }

export type LuxVersionRelation = "upgrade" | "current" | "downgrade"

export type LuxRelease = {
  tag: string
  name: string
  publishedAt: string
  htmlUrl: string
  notesExcerpt: string
  prerelease: boolean
  relation: LuxVersionRelation
  losesVersionManagement: boolean
}

export type LuxReleasesSnapshot = {
  current: string
  latestStable: string | null
  updateAvailable: boolean
  releases: LuxRelease[]
  error?: string
}

export function parseLuxSemver(raw: string): LuxSemver | null {
  const m = String(raw).trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/)
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) }
}

export function compareLuxSemver(a: LuxSemver, b: LuxSemver): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1
  return 0
}

export function isLuxReleaseTag(tag: string): boolean {
  return LUX_RELEASE_TAG_RE.test(tag.trim())
}

export function luxTagToSemver(tag: string): LuxSemver | null {
  const t = tag.trim()
  if (!isLuxReleaseTag(t)) return null
  return parseLuxSemver(t)
}

/** True when the selected release is older than the version-management floor. */
export function losesVersionManagement(tagOrVersion: string): boolean {
  const selected = parseLuxSemver(tagOrVersion)
  const floor = parseLuxSemver(LUX_VERSION_MANAGEMENT_SINCE)
  if (!selected || !floor) return false
  return compareLuxSemver(selected, floor) < 0
}

export function luxVersionRelation(current: string, target: string): LuxVersionRelation | null {
  const a = parseLuxSemver(current)
  const b = parseLuxSemver(target)
  if (!a || !b) return null
  const cmp = compareLuxSemver(b, a)
  if (cmp > 0) return "upgrade"
  if (cmp < 0) return "downgrade"
  return "current"
}

/** Reject anything that is not a known `vX.Y.Z` release tag. */
export function validateLuxSwitchTag(tag: string, knownTags: readonly string[]): string | null {
  const trimmed = String(tag ?? "").trim()
  if (!trimmed) return "Release tag is required"
  if (!isLuxReleaseTag(trimmed)) return "Release tag must be vX.Y.Z"
  if (!knownTags.includes(trimmed)) return "Unknown release tag"
  return null
}

/** Non-zero wrapper exit after the start marker. Exit 0 is a finished rebuild, not a failure. */
export function luxUpgradeFailureFromLog(log: string, tag: string): string | null {
  const marker = `=== LUX switch to ${tag} started`
  const at = log.lastIndexOf(marker)
  if (at < 0) return null
  const tail = log.slice(at)
  const exit = tail.match(/LUX_UPGRADE_EXIT:(\d+)/)
  if (!exit || exit[1] === "0") return null
  const err = tail.match(/^Error: .+$/m)
  return err ? err[0] : `Version switch exited ${exit[1]}`
}

export function excerptReleaseNotes(body: string | null | undefined, max = 240): string {
  const text = String(body ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}

export type GithubReleaseInput = {
  tag_name?: unknown
  name?: unknown
  draft?: unknown
  prerelease?: unknown
  published_at?: unknown
  html_url?: unknown
  body?: unknown
}

export function buildLuxReleasesSnapshot(
  currentVersion: string,
  raw: readonly GithubReleaseInput[],
): LuxReleasesSnapshot {
  const current = currentVersion.trim() || "0.0.0"
  const releases: LuxRelease[] = []

  for (const item of raw) {
    if (item.draft) continue
    const tag = typeof item.tag_name === "string" ? item.tag_name.trim() : ""
    if (!isLuxReleaseTag(tag)) continue
    const relation = luxVersionRelation(current, tag)
    if (!relation) continue
    const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : tag
    const publishedAt = typeof item.published_at === "string" ? item.published_at : ""
    const htmlUrl = typeof item.html_url === "string" ? item.html_url : ""
    const notesExcerpt = excerptReleaseNotes(typeof item.body === "string" ? item.body : "")
    releases.push({
      tag,
      name,
      publishedAt,
      htmlUrl,
      notesExcerpt,
      prerelease: item.prerelease === true,
      relation,
      losesVersionManagement: losesVersionManagement(tag),
    })
  }

  releases.sort((a, b) => {
    const as = luxTagToSemver(a.tag)
    const bs = luxTagToSemver(b.tag)
    if (!as || !bs) return 0
    return compareLuxSemver(bs, as)
  })

  const latestStable = releases.find((r) => !r.prerelease)?.tag ?? null
  const latestRel = latestStable ? luxVersionRelation(current, latestStable) : null

  return {
    current,
    latestStable,
    updateAvailable: latestRel === "upgrade",
    releases,
  }
}
