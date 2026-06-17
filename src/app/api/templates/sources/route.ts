/**
 * GET  /api/templates/sources?source=badsectorlabs  — list available templates from a source
 *
 * Proxies the GitLab/GitHub tree API server-side to avoid CORS issues and to add
 * light response caching.  The default source is the official badsectorlabs
 * ludus-source-bsl repository.  A custom git repo URL can be provided via the
 * `repoUrl` query parameter.
 *
 * Response: { templates: { name: string; files: string[] }[] }
 */

import { NextRequest, NextResponse } from "next/server"
import { assertSafeTemplateRepoUrl } from "@/lib/safe-template-repo-url"
import {
  fetchLudusTemplateCatalog,
  fetchLudusTemplateCatalogBySourceId,
  resolveBadslCatalogMeta,
} from "@/lib/ludus-source-catalog"
import { requireSourcesSession } from "@/lib/ludus-sources-route-helpers"
import { isGitHubApiBase, listRepoDirectory, apiBaseToGitUrl } from "@/lib/template-repo-client"


const BADSL_REF     = "main"
const BADSL_BASE    = "https://api.github.com/repos/badsectorlabs/ludus-source-bsl"

// Simple in-process cache so repeated UI renders don't hammer GitLab
interface CacheEntry { data: unknown; ts: number }
const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 5 * 60 * 1000

function repoApiLabel(apiBase: string): string {
  return isGitHubApiBase(apiBase) ? "GitHub" : "GitLab"
}

/** Fetch a URL with a per-attempt timeout and exponential-backoff retry.
 *  Returns parsed JSON. */
async function fetchWithRetry<T>(
  task: () => Promise<T>,
  apiLabel: string,
  maxAttempts = 3,
  timeoutMs = 12_000,
): Promise<T> {
  let lastErr: Error = new Error("Unknown error")

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const data = await Promise.race([
        task(),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener("abort", () => {
            reject(new Error("timeout"))
          })
        }),
      ])
      clearTimeout(timer)
      return data
    } catch (err) {
      clearTimeout(timer)
      const msg = (err as Error).message
      if (msg.includes("abort") || msg.includes("timeout")) {
        lastErr = new Error(
          `${apiLabel} API timed out after ${timeoutMs / 1000}s — check internet connectivity or try again.`,
        )
      } else if (/API 429/.test(msg)) {
        lastErr = new Error(`${apiLabel} rate limit hit (429). Wait a moment and try again.`)
      } else if (/API 5\d\d/.test(msg)) {
        lastErr = new Error(`${apiLabel} server error: ${msg}`)
      } else {
        lastErr = err as Error
      }
    }

    if (attempt < maxAttempts) {
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

async function cachedFetch<T>(key: string, task: () => Promise<T>, apiLabel: string): Promise<T> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.data as T
  const data = await fetchWithRetry(task, apiLabel)
  cache.set(key, { data, ts: Date.now() })
  return data
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const source   = searchParams.get("source")   || "badsectorlabs"
  const sourceId = searchParams.get("sourceId") || ""
  const repoUrl  = searchParams.get("repoUrl")  || ""

  let apiBase: string
  let templatesPath: string
  let ref: string

  if (source === "registered" && sourceId) {
    apiBase = BADSL_BASE
    templatesPath = "templates"
    ref = searchParams.get("ref") || BADSL_REF
  } else if (source === "badsectorlabs") {
    apiBase        = BADSL_BASE
    templatesPath  = "templates"
    ref            = BADSL_REF
  } else if (repoUrl) {
    const safe = assertSafeTemplateRepoUrl(repoUrl)
    if (!safe.ok) {
      return NextResponse.json({ error: safe.error }, { status: 400 })
    }
    apiBase = safe.apiBase
    templatesPath  = searchParams.get("path") || "templates"
    ref            = searchParams.get("ref")  || "main"
  } else {
    return NextResponse.json({ error: "Unknown source; provide repoUrl" }, { status: 400 })
  }

  try {
    const { apiKey } = await requireSourcesSession(request)
    if (apiKey) {
      if (source === "registered" && sourceId) {
        const ludusTemplates = await fetchLudusTemplateCatalogBySourceId(
          apiKey,
          sourceId,
          ref,
          apiBase,
        )
        if (ludusTemplates && ludusTemplates.length > 0) {
          return NextResponse.json({
            templates: ludusTemplates,
            catalogSource: "ludus",
            registeredSourceId: sourceId,
          })
        }
      } else {
        const gitUrl =
          source === "badsectorlabs"
            ? resolveBadslCatalogMeta().gitUrl
            : apiBaseToGitUrl(apiBase)
        if (gitUrl) {
          const ludusTemplates = await fetchLudusTemplateCatalog(apiKey, gitUrl, ref, apiBase)
          if (ludusTemplates && ludusTemplates.length > 0) {
            return NextResponse.json({ templates: ludusTemplates, catalogSource: "ludus" })
          }
        }
      }
    }

    const apiLabel = repoApiLabel(apiBase)
    const cacheKey = `${apiBase}|${templatesPath}|${ref}`

    // List top-level directories inside the templates folder
    const topTree = await cachedFetch(
      cacheKey,
      () => listRepoDirectory(apiBase, templatesPath, ref),
      apiLabel,
    )
    const dirs = topTree.filter((i) => i.type === "tree")

    // Fetch each directory's file listing concurrently but cap at 5 in-flight
    // to avoid hammering the host API and triggering rate limits.
    const templates = await pLimit(
      dirs.map((dir) => async () => {
        const fileTree = await cachedFetch(
          `${cacheKey}|${dir.path}`,
          () => listRepoDirectory(apiBase, dir.path, ref),
          apiLabel,
        )
        const files = fileTree.filter((i) => i.type === "blob").map((i) => i.name)
        return { name: dir.name, path: dir.path, files, ref, apiBase }
      }),
      5,
    )

    return NextResponse.json({ templates, catalogSource: "github" })
  } catch (err) {
    const msg = (err as Error).message
    return NextResponse.json(
      { error: `Failed to fetch template source: ${msg}` },
      { status: 502 },
    )
  }
}
