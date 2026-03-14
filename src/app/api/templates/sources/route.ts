/**
 * GET  /api/templates/sources?source=badsectorlabs  — list available templates from a source
 *
 * Proxies the GitLab tree API server-side to avoid CORS issues and to add
 * light response caching.  The default source is the official badsectorlabs
 * Ludus repository.  A custom GitLab/GitHub URL can be provided via the
 * `repoUrl` query parameter.
 *
 * Response: { templates: { name: string; files: string[] }[] }
 */

import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"

const BADSL_PROJECT = "badsectorlabs%2Fludus"
const BADSL_REF     = "main"
const BADSL_BASE    = `https://gitlab.com/api/v4/projects/${BADSL_PROJECT}/repository`

// Simple in-process cache so repeated UI renders don't hammer GitLab
interface CacheEntry { data: unknown; ts: number }
const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 5 * 60 * 1000

async function cachedFetch(url: string): Promise<unknown> {
  const hit = cache.get(url)
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.data
  const res = await fetch(url, { headers: { "User-Agent": "ludus-ux/1.0" } })
  if (!res.ok) throw new Error(`GitLab API error ${res.status} for ${url}`)
  const data = await res.json()
  cache.set(url, { data, ts: Date.now() })
  return data
}

interface GitLabTreeItem {
  id: string
  name: string
  type: "tree" | "blob"
  path: string
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const source   = searchParams.get("source")   || "badsectorlabs"
  const repoUrl  = searchParams.get("repoUrl")  || ""  // custom GitLab project API base URL

  // Determine the GitLab repository API base and templates path prefix
  let apiBase: string
  let templatesPath: string
  let ref: string

  if (source === "badsectorlabs") {
    apiBase        = BADSL_BASE
    templatesPath  = "templates"
    ref            = BADSL_REF
  } else if (repoUrl) {
    // Expect the caller to pass the full GitLab API base, e.g.
    // https://gitlab.com/api/v4/projects/owner%2Frepo/repository
    apiBase        = repoUrl.replace(/\/$/, "")
    templatesPath  = searchParams.get("path") || "templates"
    ref            = searchParams.get("ref")  || "main"
  } else {
    return NextResponse.json({ error: "Unknown source; provide repoUrl" }, { status: 400 })
  }

  try {
    // List top-level directories inside the templates folder
    const topUrl  = `${apiBase}/tree?path=${encodeURIComponent(templatesPath)}&ref=${ref}&per_page=100`
    const topTree = (await cachedFetch(topUrl)) as GitLabTreeItem[]
    const dirs    = topTree.filter((i) => i.type === "tree")

    // For each directory, list the files it contains (one level deep)
    const templates = await Promise.all(
      dirs.map(async (dir) => {
        const fileUrl  = `${apiBase}/tree?path=${encodeURIComponent(dir.path)}&ref=${ref}&per_page=100`
        const fileTree = (await cachedFetch(fileUrl)) as GitLabTreeItem[]
        const files    = fileTree.filter((i) => i.type === "blob").map((i) => i.name)
        return { name: dir.name, path: dir.path, files, ref, apiBase }
      })
    )

    return NextResponse.json({ templates })
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to fetch template source: ${(err as Error).message}` },
      { status: 502 }
    )
  }
}
