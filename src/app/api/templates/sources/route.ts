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

interface GitLabTreeItem {
  id: string
  name: string
  type: "tree" | "blob"
  path: string
}

/** Fetch a URL with a per-attempt timeout and exponential-backoff retry.
 *  Returns parsed JSON. */
async function fetchWithRetry(
  url: string,
  maxAttempts = 3,
  timeoutMs = 12_000,
): Promise<unknown> {
  let lastErr: Error = new Error("Unknown error")

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "ludus-ux/1.0" },
        signal: controller.signal,
      })
      clearTimeout(timer)

      if (res.ok) return await res.json()

      // Don't retry client errors (4xx) except 429 (rate limit)
      if (res.status !== 429 && res.status < 500) {
        throw new Error(`GitLab API ${res.status} for ${url}`)
      }

      lastErr = new Error(
        res.status === 429
          ? `GitLab rate limit hit (429). Wait a moment and try again.`
          : `GitLab server error ${res.status} for ${url}`
      )
    } catch (err) {
      clearTimeout(timer)
      const msg = (err as Error).message
      if (msg.includes("abort") || msg.includes("timeout")) {
        lastErr = new Error(`GitLab API timed out after ${timeoutMs / 1000}s — check internet connectivity or try again.`)
      } else {
        lastErr = err as Error
      }
    }

    if (attempt < maxAttempts) {
      // Exponential backoff: 1 s, 2 s, 4 s …
      await new Promise((r) => setTimeout(r, 1_000 * attempt))
    }
  }

  throw lastErr
}

/** Run up to `limit` async tasks concurrently. */
async function pLimit<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length)
  let next = 0

  async function worker() {
    while (next < tasks.length) {
      const i = next++
      results[i] = await tasks[i]()
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, worker),
  )
  return results
}

async function cachedFetch(url: string): Promise<unknown> {
  const hit = cache.get(url)
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.data
  const data = await fetchWithRetry(url)
  cache.set(url, { data, ts: Date.now() })
  return data
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const source   = searchParams.get("source")   || "badsectorlabs"
  const repoUrl  = searchParams.get("repoUrl")  || ""

  let apiBase: string
  let templatesPath: string
  let ref: string

  if (source === "badsectorlabs") {
    apiBase        = BADSL_BASE
    templatesPath  = "templates"
    ref            = BADSL_REF
  } else if (repoUrl) {
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

    // Fetch each directory's file listing concurrently but cap at 5 in-flight
    // to avoid hammering GitLab and triggering rate limits.
    const templates = await pLimit(
      dirs.map((dir) => async () => {
        const fileUrl  = `${apiBase}/tree?path=${encodeURIComponent(dir.path)}&ref=${ref}&per_page=100`
        const fileTree = (await cachedFetch(fileUrl)) as GitLabTreeItem[]
        const files    = fileTree.filter((i) => i.type === "blob").map((i) => i.name)
        return { name: dir.name, path: dir.path, files, ref, apiBase }
      }),
      5,
    )

    return NextResponse.json({ templates })
  } catch (err) {
    const msg = (err as Error).message
    return NextResponse.json(
      { error: `Failed to fetch template source: ${msg}` },
      { status: 502 },
    )
  }
}
