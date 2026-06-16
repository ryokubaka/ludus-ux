/**
 * POST /api/blueprints/import-from-source
 *
 * Installs blueprints from a remote git tree (e.g. ludus-source-bsl/blueprints/*).
 *
 * Tries, in order:
 *  1. Ludus Sources API (POST /sources + POST /sources/{id}/install) — newest Ludus
 *  2. POST /blueprints with fetched YAML — widely available
 *  3. POST /blueprints/from-range + PUT config — older fallback
 *  4. POST /blueprints/import tar.gz — when only import exists without sources
 */

import { NextRequest, NextResponse } from "next/server"
import { resolveAdminImpersonationFromRequest } from "@/lib/admin-impersonation-request"
import { buildBlueprintTarGz } from "@/lib/blueprint-bundle"
import {
  createBlueprintFromRangeBundle,
  createBlueprintFromRepoBundle,
  isHttp404Error,
  loadBlueprintRepoBundle,
} from "@/lib/blueprint-source-import"
import { effectiveScopeTagFromSession } from "@/lib/effective-scope"
import { revalidateLudusResource, revalidateLudusScopeResource } from "@/lib/ludus-cache-revalidate"
import { logLuxRouteAction } from "@/lib/lux-api-audit"
import { resolveSession } from "@/lib/session"
import {
  blueprintPublicId,
  buildLudusApiUrl,
  ensureGitSource,
  gitUrlForBadsectorlabs,
  installSourceBlueprints,
} from "@/lib/ludus-source-client"
import { fetchAllRepoBlobs, fetchRepoRawFile } from "@/lib/template-repo-client"

export const maxDuration = 300

interface BlueprintSpec {
  name: string
  gitUrl?: string
  ref?: string
  path?: string
  apiBase?: string
}

const NAME_RE = /^[a-zA-Z0-9._-]{1,120}$/
const BADSL_API_BASE = "https://api.github.com/repos/badsectorlabs/ludus-source-bsl"

function resolveGitUrl(spec: BlueprintSpec): { gitUrl: string; ref: string } {
  if (spec.gitUrl?.trim()) {
    return { gitUrl: spec.gitUrl.trim(), ref: spec.ref?.trim() || "main" }
  }
  if (spec.apiBase && normalizeApiBase(spec.apiBase) === normalizeApiBase(BADSL_API_BASE)) {
    return { gitUrl: gitUrlForBadsectorlabs(), ref: spec.ref?.trim() || "main" }
  }
  throw new Error(`Blueprint "${spec.name}" is missing gitUrl for Ludus source registration`)
}

function normalizeApiBase(apiBase: string): string {
  return apiBase.trim().replace(/\/$/, "").toLowerCase()
}

function relativeBlueprintPath(repoPath: string, blueprintRoot: string): string {
  const prefix = blueprintRoot.endsWith("/") ? blueprintRoot : `${blueprintRoot}/`
  if (repoPath.startsWith(prefix)) return repoPath.slice(prefix.length)
  return repoPath.split("/").pop() ?? repoPath
}

async function importViaTarArchive(
  spec: BlueprintSpec & { path: string; apiBase: string; ref: string },
  apiKey: string,
): Promise<{ blueprintID?: string; message: string }> {
  const blobs = await fetchAllRepoBlobs(spec.apiBase, spec.path, spec.ref)
  if (blobs.length === 0) throw new Error(`No files found under ${spec.path}`)

  const fileEntries = await Promise.all(
    blobs.map(async (blob) => ({
      relativePath: relativeBlueprintPath(blob.path, spec.path),
      content: Buffer.from(await fetchRepoRawFile(spec.apiBase, blob.path, spec.ref), "utf8"),
    })),
  )

  const archive = await buildBlueprintTarGz(fileEntries)
  const formData = new FormData()
  formData.append(
    "archive",
    new Blob([Uint8Array.from(archive)], { type: "application/gzip" }),
    `${spec.name}.tar.gz`,
  )

  const res = await fetch(buildLudusApiUrl("/blueprints/import"), {
    method: "POST",
    headers: { "X-API-KEY": apiKey },
    body: formData,
    cache: "no-store",
  })

  const data = (await res.json().catch(() => null)) as {
    result?: string
    blueprintID?: string
    error?: string
    roleResults?: Array<{ ok?: boolean; name?: string; error?: string }>
  } | null

  if (!res.ok) {
    throw new Error(data?.error || data?.result || `HTTP ${res.status}`)
  }

  let message = data?.result || `Blueprint "${spec.name}" imported successfully`
  const failedRoles = (data?.roleResults ?? []).filter((r) => r.ok === false)
  if (failedRoles.length > 0) {
    message += ` Role install issues: ${failedRoles.map((r) => `${r.name ?? "?"}${r.error ? `: ${r.error}` : ""}`).join("; ")}`
  }

  return { blueprintID: data?.blueprintID, message }
}

async function importViaSourcesApi(
  spec: BlueprintSpec,
  apiKey: string,
): Promise<{ blueprintID: string; message: string }> {
  const { gitUrl, ref } = resolveGitUrl(spec)
  const sourceID = await ensureGitSource(apiKey, gitUrl, ref)
  const { warnings } = await installSourceBlueprints(apiKey, sourceID, [spec.name])
  const blueprintID = blueprintPublicId(sourceID, spec.name)
  let message = `Blueprint "${blueprintID}" installed from Ludus source`
  if (warnings.length > 0) message += `. ${warnings.join("; ")}`
  return { blueprintID, message }
}

async function importBlueprintFromSource(
  spec: BlueprintSpec,
  apiKey: string,
): Promise<{ success: true; blueprintID?: string; message: string } | { success: false; message: string }> {
  if (!spec.path || !spec.apiBase || !spec.ref) {
    return { success: false, message: "Missing repository path metadata for import" }
  }

  const repoPath = { path: spec.path, apiBase: spec.apiBase, ref: spec.ref }
  const failures: string[] = []

  // 1. Ludus Sources (git catalog install)
  try {
    const r = await importViaSourcesApi(spec, apiKey)
    return { success: true, blueprintID: r.blueprintID, message: r.message }
  } catch (err) {
    if (!isHttp404Error(err)) failures.push(`Sources: ${(err as Error).message}`)
    else failures.push("Sources API not available")
  }

  let bundle
  try {
    bundle = await loadBlueprintRepoBundle(spec.apiBase, spec.path, spec.ref, spec.name)
  } catch (err) {
    return { success: false, message: (err as Error).message }
  }

  // 2. POST /blueprints with YAML from repo
  try {
    const r = await createBlueprintFromRepoBundle(apiKey, bundle)
    return { success: true, blueprintID: r.blueprintID, message: r.message }
  } catch (err) {
    failures.push(`Create: ${(err as Error).message}`)
  }

  // 3. from-range + config upload
  try {
    const r = await createBlueprintFromRangeBundle(apiKey, bundle)
    return { success: true, blueprintID: r.blueprintID, message: r.message }
  } catch (err) {
    failures.push(`From-range: ${(err as Error).message}`)
  }

  // 4. tar import
  try {
    const r = await importViaTarArchive({ ...spec, ...repoPath }, apiKey)
    return {
      success: true,
      blueprintID: r.blueprintID,
      message: r.message,
    }
  } catch (err) {
    failures.push(`Tar import: ${(err as Error).message}`)
  }

  return {
    success: false,
    message: failures.join(" · "),
  }
}

export async function POST(request: NextRequest) {
  const session = await resolveSession(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  let body: { blueprints: BlueprintSpec[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const { blueprints } = body
  if (!Array.isArray(blueprints) || blueprints.length === 0) {
    return NextResponse.json({ error: "No blueprints specified" }, { status: 400 })
  }

  for (const spec of blueprints) {
    if (!NAME_RE.test(spec.name ?? "")) {
      return NextResponse.json(
        {
          error: `Invalid blueprint name "${spec.name}". Use only letters, numbers, hyphens, underscores, and dots.`,
        },
        { status: 400 },
      )
    }
  }

  const effectiveApiKey =
    resolveAdminImpersonationFromRequest(session, request).apiKey || session.apiKey

  const results = await Promise.allSettled(
    blueprints.map((spec) =>
      importBlueprintFromSource(spec, effectiveApiKey)
        .then((r) => ({
          name: spec.name,
          success: r.success,
          blueprintID: r.success ? r.blueprintID : undefined,
          message: r.message,
        }))
        .catch((e) => ({
          name: spec.name,
          success: false,
          message: (e as Error).message,
        })),
    ),
  )

  const mapped = results.map((r) =>
    r.status === "fulfilled"
      ? r.value
      : { name: "?", success: false, message: String(r.reason) },
  )

  const anyOk = mapped.some((r) => r.success)
  if (anyOk) {
    const scopeTag = effectiveScopeTagFromSession(session)
    revalidateLudusResource("blueprints")
    revalidateLudusScopeResource(scopeTag, "blueprints")
  }

  const allOk = mapped.every((r) => r.success)
  logLuxRouteAction(request, session, {
    outcome: allOk ? "success" : "failure",
    detail: `blueprints=${blueprints.map((b) => b.name).join(",")}`,
  })

  return NextResponse.json({ results: mapped })
}
