/**
 * Local documentation corpus for the in-app assistant.
 * Indexes LUX docs/, skill references, and cached Ludus docs (DATA_DIR/docs-cache/ludus).
 * Full docs.ludus.cloud cannot fit in a system prompt — search/fetch on demand instead.
 */

import fs from "fs"
import path from "path"

export type DocHit = {
  source: "lux" | "skill" | "ludus-cache"
  title: string
  path: string
  url?: string
  score: number
  excerpt: string
}

export type DocPage = {
  source: DocHit["source"]
  title: string
  path: string
  url?: string
  body: string
}

const LUDUS_DOCS_ORIGIN = "https://docs.ludus.cloud"

/** Core Ludus docs pages to seed into the cache (Docusaurus paths). */
export const LUDUS_DOC_SEED_PATHS = [
  "/docs/intro",
  "/docs/quick-start",
  "/docs/quick-start/using-cli-locally",
  "/docs/quick-start/build-templates",
  "/docs/configuration",
  "/docs/cli",
  "/docs/category/environment-guides",
  "/docs/environment-guides/goad-dracarys",
  "/docs/environment-guides/shadow-steps",
  "/docs/troubleshooting/client",
  "/docs/troubleshooting/network",
  "/docs/troubleshooting/wireguard",
  "/docs/troubleshooting/api-key-issues",
  "/docs/troubleshooting/packer-cache-cleanup",
  "/docs/using-ludus/mcp",
  "/docs/api",
]

function dataDir(): string {
  return process.env.DATA_DIR?.trim() || path.join(process.cwd(), "data")
}

export function ludusDocsCacheDir(): string {
  return path.join(dataDir(), "docs-cache", "ludus")
}

function walkMarkdown(root: string): string[] {
  if (!fs.existsSync(root)) return []
  const out: string[] = []
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".git") continue
        stack.push(full)
      } else if (e.isFile() && /\.(md|mdx)$/i.test(e.name)) {
        out.push(full)
      }
    }
  }
  return out
}

function titleFromMarkdown(body: string, fallback: string): string {
  const m = body.match(/^#\s+(.+)$/m)
  return (m?.[1] || fallback).replace(/\s+/g, " ").trim().slice(0, 120)
}

function htmlToApproxMarkdown(html: string): string {
  let t = html
  // Drop scripts/styles/nav chrome roughly
  t = t.replace(/<script[\s\S]*?<\/script>/gi, "")
  t = t.replace(/<style[\s\S]*?<\/style>/gi, "")
  t = t.replace(/<nav[\s\S]*?<\/nav>/gi, " ")
  t = t.replace(/<!--[\s\S]*?-->/g, " ")
  t = t.replace(/<\/?(h[1-6])[^>]*>/gi, (m, tag) => {
    const n = Number(String(tag).slice(1))
    if (m.startsWith("</")) return "\n\n"
    return `\n\n${"#".repeat(Math.min(n, 6))} `
  })
  t = t.replace(/<\/p>/gi, "\n\n")
  t = t.replace(/<br\s*\/?>/gi, "\n")
  t = t.replace(/<li[^>]*>/gi, "\n- ")
  t = t.replace(/<\/?(ul|ol|div|section|article|main|header|footer)[^>]*>/gi, "\n")
  t = t.replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
    const label = String(text).replace(/<[^>]+>/g, "").trim()
    return label ? `[${label}](${href})` : href
  })
  t = t.replace(/<[^>]+>/g, " ")
  t = t
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
  t = t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
  return t
}

function slugFromDocPath(docPath: string): string {
  return docPath
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/[^\w.-]+/g, "_")
    .slice(0, 160)
}

export function collectDocPages(): DocPage[] {
  const pages: DocPage[] = []

  const luxDocs = path.join(process.cwd(), "docs")
  for (const fp of walkMarkdown(luxDocs)) {
    // Skip OpenAPI-ish and huge generated if any
    if (fp.endsWith("openapi.yaml")) continue
    try {
      const body = fs.readFileSync(fp, "utf8")
      const rel = path.relative(process.cwd(), fp)
      pages.push({
        source: "lux",
        title: titleFromMarkdown(body, path.basename(fp, path.extname(fp))),
        path: rel,
        body,
      })
    } catch {
      /* ignore */
    }
  }

  const skillsDirCandidates = [
    path.join(process.cwd(), "skills"),
    path.join(process.cwd(), "..", "skills"),
  ]
  for (const skillsDir of skillsDirCandidates) {
    if (!fs.existsSync(skillsDir)) continue
    for (const fp of walkMarkdown(skillsDir)) {
      try {
        const body = fs.readFileSync(fp, "utf8")
        const rel = path.relative(process.cwd(), fp)
        pages.push({
          source: "skill",
          title: titleFromMarkdown(body, path.basename(fp, path.extname(fp))),
          path: rel,
          body,
        })
      } catch {
        /* ignore */
      }
    }
    break
  }

  const cache = ludusDocsCacheDir()
  for (const fp of walkMarkdown(cache)) {
    try {
      const body = fs.readFileSync(fp, "utf8")
      const metaUrl = body.match(/^url:\s*(.+)$/m)?.[1]?.trim()
      const rel = path.relative(process.cwd(), fp)
      pages.push({
        source: "ludus-cache",
        title: titleFromMarkdown(body, path.basename(fp, path.extname(fp))),
        path: rel,
        url: metaUrl,
        body,
      })
    } catch {
      /* ignore */
    }
  }

  return pages
}

function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^a-z0-9_./+-]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
}

/** Simple lexical search over the corpus. */
export function searchDocumentation(query: string, limit = 8): DocHit[] {
  const tokens = tokenize(query)
  if (tokens.length === 0) return []
  const pages = collectDocPages()
  const scored: DocHit[] = []

  for (const p of pages) {
    const hay = `${p.title}\n${p.path}\n${p.body}`.toLowerCase()
    let score = 0
    for (const t of tokens) {
      if (!hay.includes(t)) continue
      const titleHit = p.title.toLowerCase().includes(t) ? 8 : 0
      const pathHit = p.path.toLowerCase().includes(t) ? 4 : 0
      const count = hay.split(t).length - 1
      score += titleHit + pathHit + Math.min(count, 12)
    }
    if (score <= 0) continue
    // Prefer LUX product docs; ludus-ux skill over upstream Ludus skills; workflow playbooks win for deploy how-tos
    if (p.source === "lux") score += 1
    if (p.source === "skill") score += 2
    const normPath = p.path.replace(/\\/g, "/")
    if (normPath.includes("skills/ludus-ux/")) score += 3
    // Upstream badsectorlabs/ludus-skills vendored under skills/ludus/ — supplement only
    if (normPath.includes("skills/ludus/") && !normPath.includes("skills/ludus-ux/")) score += 0
    if (/\/workflows\//.test(normPath)) score += 6
    if (/workflows\/INDEX\.md$/i.test(normPath)) score += 4
    const idx = hay.indexOf(tokens[0])
    const start = Math.max(0, idx - 80)
    const excerpt = p.body.replace(/\s+/g, " ").slice(start, start + 320).trim()
    scored.push({
      source: p.source,
      title: p.title,
      path: p.path,
      url: p.url,
      score,
      excerpt: excerpt || p.body.slice(0, 280),
    })
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.min(limit, 20)))
}

export function readDocByPath(relOrAbs: string): DocPage | null {
  const pages = collectDocPages()
  const norm = relOrAbs.replace(/\\/g, "/")
  return (
    pages.find((p) => p.path.replace(/\\/g, "/") === norm || p.path.endsWith(norm) || p.url === norm) ||
    null
  )
}

function isAllowedLudusDocsUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    if (u.protocol !== "https:") return false
    if (u.hostname !== "docs.ludus.cloud") return false
    return u.pathname.startsWith("/docs")
  } catch {
    return false
  }
}

export function normalizeLudusDocsUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (trimmed.startsWith("/docs")) return `${LUDUS_DOCS_ORIGIN}${trimmed}`
  if (trimmed.startsWith("docs/")) return `${LUDUS_DOCS_ORIGIN}/${trimmed}`
  if (/^https?:\/\//i.test(trimmed)) return isAllowedLudusDocsUrl(trimmed) ? trimmed.replace(/\/$/, "") : null
  return `${LUDUS_DOCS_ORIGIN}/docs/${trimmed.replace(/^\/+/, "")}`
}

/** Fetch one Ludus docs page and cache under DATA_DIR. */
export async function fetchAndCacheLudusDoc(
  inputUrl: string,
): Promise<{ ok: true; path: string; url: string; title: string; chars: number } | { ok: false; error: string }> {
  const url = normalizeLudusDocsUrl(inputUrl)
  if (!url) return { ok: false, error: "Only https://docs.ludus.cloud/docs/* URLs are allowed" }

  let res: Response
  try {
    res = await fetch(url, {
      headers: {
        Accept: "text/html,text/plain,*/*",
        "User-Agent": "LudusUX-Assistant/1.2 (+docs-cache)",
      },
      signal: AbortSignal.timeout(30_000),
      redirect: "follow",
    })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  if (!res.ok) return { ok: false, error: `HTTP ${res.status} for ${url}` }

  const html = await res.text()
  const md = htmlToApproxMarkdown(html)
  if (md.length < 80) return { ok: false, error: "Fetched page had too little text" }

  const title = titleFromMarkdown(md, url)
  const u = new URL(url)
  const slug = slugFromDocPath(u.pathname)
  const dir = ludusDocsCacheDir()
  fs.mkdirSync(dir, { recursive: true })
  const fp = path.join(dir, `${slug}.md`)
  const body = [
    "---",
    `url: ${url}`,
    `fetched_at: ${new Date().toISOString()}`,
    "---",
    "",
    `# ${title}`,
    "",
    md,
    "",
  ].join("\n")
  fs.writeFileSync(fp, body, "utf8")
  return { ok: true, path: path.relative(process.cwd(), fp), url, title, chars: body.length }
}

/** Seed cache with curated Ludus docs pages (skips existing unless force). */
export async function seedLudusDocsCache(opts?: {
  force?: boolean
  paths?: string[]
}): Promise<{ fetched: string[]; skipped: string[]; errors: Array<{ path: string; error: string }> }> {
  const paths = opts?.paths || LUDUS_DOC_SEED_PATHS
  const fetched: string[] = []
  const skipped: string[] = []
  const errors: Array<{ path: string; error: string }> = []
  const dir = ludusDocsCacheDir()
  fs.mkdirSync(dir, { recursive: true })

  for (const p of paths) {
    const url = normalizeLudusDocsUrl(p)
    if (!url) continue
    const slug = slugFromDocPath(new URL(url).pathname)
    const fp = path.join(dir, `${slug}.md`)
    if (!opts?.force && fs.existsSync(fp)) {
      skipped.push(p)
      continue
    }
    const res = await fetchAndCacheLudusDoc(url)
    if (res.ok) fetched.push(p)
    else errors.push({ path: p, error: res.error })
    // Be polite to the docs host
    await new Promise((r) => setTimeout(r, 150))
  }
  return { fetched, skipped, errors }
}

export function docsCorpusStats(): { pages: number; bySource: Record<string, number>; cacheDir: string } {
  const pages = collectDocPages()
  const bySource: Record<string, number> = {}
  for (const p of pages) bySource[p.source] = (bySource[p.source] || 0) + 1
  return { pages: pages.length, bySource, cacheDir: ludusDocsCacheDir() }
}
