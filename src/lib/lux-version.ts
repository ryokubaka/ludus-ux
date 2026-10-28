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
  /** vX.Y.Z branch with no published GitHub release of the same name. */
  unpublished: boolean
  relation: LuxVersionRelation
  losesVersionManagement: boolean
}

export type LuxReleasesSnapshot = {
  current: string
  latestStable: string | null
  updateAvailable: boolean
  releases: LuxRelease[]
  /** Browse URL for the clone's remote. Empty when the remote has no web page. */
  repoUrl?: string
  /** Upgrade docs on that same remote. */
  docsUrl?: string
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

/** A remote head named like a release. html_url is the branch page when known. */
export type LuxReleaseBranchInput = {
  name?: unknown
  html_url?: unknown
}

export function buildLuxReleasesSnapshot(
  currentVersion: string,
  raw: readonly GithubReleaseInput[],
  branches: readonly LuxReleaseBranchInput[] = [],
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
      unpublished: false,
      relation,
      losesVersionManagement: losesVersionManagement(tag),
    })
  }

  const published = new Set(releases.map((release) => release.tag))
  for (const branch of branches) {
    const tag = typeof branch.name === "string" ? branch.name.trim() : ""
    if (!isLuxReleaseTag(tag) || published.has(tag)) continue
    const relation = luxVersionRelation(current, tag)
    if (!relation) continue
    published.add(tag)
    const htmlUrl = typeof branch.html_url === "string" ? branch.html_url : ""
    releases.push({
      tag,
      name: tag,
      publishedAt: "",
      htmlUrl,
      notesExcerpt: "",
      prerelease: false,
      unpublished: true,
      relation,
      losesVersionManagement: losesVersionManagement(tag),
    })
  }

  releases.sort((a, b) => {
    const as = luxTagToSemver(a.tag)
    const bs = luxTagToSemver(b.tag)
    if (!as || !bs) return 0
    const cmp = compareLuxSemver(bs, as)
    if (cmp !== 0) return cmp
    if (a.unpublished !== b.unpublished) return a.unpublished ? 1 : -1
    return 0
  })

  const latestStable = releases.find((r) => !r.prerelease && !r.unpublished)?.tag ?? null
  const latestRel = latestStable ? luxVersionRelation(current, latestStable) : null

  return {
    current,
    latestStable,
    updateAvailable: latestRel === "upgrade",
    releases,
  }
}

export type LuxGitRemote = {
  /** HTTPS repo page with credentials removed. */
  webUrl: string
  docsUrl: string
  /** owner/repo when the host is github.com, so release notes can be filled in. */
  githubRepo: string | null
  tagUrl: (tag: string) => string
  branchUrl: (tag: string) => string
}

function gitRemoteHost(hostport: string): string {
  const host = hostport.replace(/^www\./i, "").toLowerCase()
  const port = /^(.*):(\d+)$/.exec(host)
  if (port && !port[1].includes(":")) return port[1]
  return host
}

function gitRemotePath(raw: string): string {
  return raw.replace(/\.git$/i, "").replace(/\/+$/, "").replace(/^\/+/, "")
}

/**
 * Browse links for the clone remote. Accepts https, ssh://, and git@host:path.
 * Userinfo is dropped so a token in the remote URL never reaches the page.
 * GitHub and GitLab get per-version links. Any other https remote links the repo root.
 */
export function parseLuxGitRemote(raw: string): LuxGitRemote | null {
  const url = raw.trim()
  if (!url || /[\r\n\0\s]/.test(url) || url.length > 500) return null

  const scp = /^git@([^:]+):(.+)$/.exec(url)
  const ssh = /^ssh:\/\/(?:[^@/]+@)?([^/]+)\/(.+)$/.exec(url)
  const https = /^https?:\/\/(?:[^@/]+@)?([^/]+)\/(.+)$/.exec(url)
  const matched = scp ?? ssh ?? https
  if (!matched) return null

  const host = gitRemoteHost(matched[1] ?? "")
  const path = gitRemotePath(matched[2] ?? "")
  if (!host || !path || path.includes("..") || /[?#]/.test(path)) return null

  const isGithub = host === "github.com"
  const isGitlab = host === "gitlab.com" || host.includes("gitlab")
  if (isGithub) {
    const parts = path.split("/").filter(Boolean)
    if (parts.length < 2) return null
    const repo = `${parts[0]}/${parts[1]}`
    const web = `https://github.com/${repo}`
    return {
      webUrl: web,
      docsUrl: `${web}/blob/main/docs/getting-started.md#upgrade-and-downgrade`,
      githubRepo: repo,
      tagUrl: (tag) => `${web}/releases/tag/${encodeURIComponent(tag)}`,
      branchUrl: (tag) => `${web}/tree/${encodeURIComponent(tag)}`,
    }
  }

  if (isGitlab) {
    const web = `https://${host}/${path}`
    return {
      webUrl: web,
      docsUrl: `${web}/-/blob/main/docs/getting-started.md#upgrade-and-downgrade`,
      githubRepo: null,
      tagUrl: (tag) => `${web}/-/tags/${encodeURIComponent(tag)}`,
      branchUrl: (tag) => `${web}/-/tree/${encodeURIComponent(tag)}`,
    }
  }

  if (!https) {
    return {
      webUrl: "",
      docsUrl: "",
      githubRepo: null,
      tagUrl: () => "",
      branchUrl: () => "",
    }
  }
  const web = `https://${host}/${path}`
  return {
    webUrl: web,
    docsUrl: web,
    githubRepo: null,
    tagUrl: () => "",
    branchUrl: () => "",
  }
}

/**
 * Tags on the clone remote are published releases. vX.Y.Z branches with no tag
 * of the same name are unpublished. GitHub release objects only add notes and dates.
 */
export function snapshotFromGitRefs(
  currentVersion: string,
  remoteUrl: string,
  heads: readonly string[],
  tags: readonly string[],
  githubReleases: readonly GithubReleaseInput[] = [],
): LuxReleasesSnapshot {
  const remote = parseLuxGitRemote(remoteUrl)
  const notes = new Map<string, GithubReleaseInput>()
  for (const item of githubReleases) {
    if (item.draft) continue
    const tag = typeof item.tag_name === "string" ? item.tag_name.trim() : ""
    if (isLuxReleaseTag(tag)) notes.set(tag, item)
  }

  const published = new Set<string>()
  const raw: GithubReleaseInput[] = []
  for (const tag of tags) {
    const name = tag.trim()
    if (!isLuxReleaseTag(name) || published.has(name)) continue
    published.add(name)
    const extra = notes.get(name)
    const html = typeof extra?.html_url === "string" && extra.html_url ? extra.html_url : remote?.tagUrl(name) ?? ""
    raw.push({
      tag_name: name,
      name: extra?.name,
      draft: false,
      prerelease: extra?.prerelease === true,
      published_at: extra?.published_at,
      html_url: html,
      body: extra?.body,
    })
  }

  const branches: LuxReleaseBranchInput[] = []
  const seenHeads = new Set<string>()
  for (const head of heads) {
    const name = head.trim()
    if (!isLuxReleaseTag(name) || published.has(name) || seenHeads.has(name)) continue
    seenHeads.add(name)
    branches.push({ name, html_url: remote?.branchUrl(name) ?? "" })
  }

  return {
    ...buildLuxReleasesSnapshot(currentVersion, raw, branches),
    repoUrl: remote?.webUrl ?? "",
    docsUrl: remote?.docsUrl ?? "",
  }
}
