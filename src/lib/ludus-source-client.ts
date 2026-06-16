import "server-only"

import { getSettings } from "@/lib/settings-store"

const BADSL_GIT_URL = "https://github.com/badsectorlabs/ludus-source-bsl"

export function buildLudusApiUrl(path: string): string {
  const settings = getSettings()
  const cleanBase = settings.ludusUrl.replace(/\/$/, "")
  const apiPath = path.startsWith("/api/v2") ? path : `/api/v2${path}`
  return `${cleanBase}${apiPath}`
}

function normalizeGitUrl(url: string): string {
  return url.trim().replace(/\/$/, "").replace(/\.git$/, "").toLowerCase()
}

export interface LudusSourceRow {
  id?: string
  sourceID?: string
  url?: string
  ref?: string
}

export interface SourceInstallResult {
  sourceID: string
  blueprintID: string
  message: string
  warnings: string[]
}

interface ArtifactResult {
  name?: string
  ok?: boolean
  message?: string
}

interface InstallResponse {
  sourceID?: string
  templateResults?: ArtifactResult[]
  blueprintResults?: {
    ansibleResults?: Array<{ name?: string; ok?: boolean; error?: string }>
  }
  error?: string
}

async function ludusJson<T>(
  path: string,
  apiKey: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; data: T | null }> {
  const res = await fetch(buildLudusApiUrl(path), {
    ...init,
    headers: {
      "X-API-KEY": apiKey,
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  })
  const data = (await res.json().catch(() => null)) as T | null
  return { ok: res.ok, status: res.status, data }
}

/** Resolve an existing git source or register a new one. */
export async function ensureGitSource(
  apiKey: string,
  gitUrl: string,
  ref: string,
): Promise<string> {
  const target = normalizeGitUrl(gitUrl)
  const listed = await ludusJson<LudusSourceRow[]>("/sources", apiKey, { method: "GET" })
  if (listed.ok && Array.isArray(listed.data)) {
    const hit = listed.data.find((s) => s.url && normalizeGitUrl(s.url) === target)
    if (hit) return hit.sourceID || hit.id || ""
  }

  const form = new FormData()
  form.append("type", "git")
  form.append("url", gitUrl.replace(/\/$/, ""))
  form.append("ref", ref || "main")

  const created = await ludusJson<{ sourceID?: string; error?: string }>("/sources", apiKey, {
    method: "POST",
    body: form,
  })
  if (!created.ok || !created.data?.sourceID) {
    const msg =
      created.data?.error ||
      (typeof created.data === "object" && created.data && "result" in created.data
        ? String((created.data as { result?: string }).result)
        : null) ||
      `Failed to register source (HTTP ${created.status})`
    throw new Error(msg)
  }
  return created.data.sourceID
}

function collectInstallWarnings(data: InstallResponse | null): string[] {
  const warnings: string[] = []
  for (const t of data?.templateResults ?? []) {
    if (t.ok === false) {
      warnings.push(`Template ${t.name ?? "?"}: ${t.message ?? "failed"}`)
    }
  }
  for (const r of data?.blueprintResults?.ansibleResults ?? []) {
    if (r.ok === false) {
      warnings.push(`Role ${r.name ?? "?"}: ${r.error ?? "failed"}`)
    }
  }
  return warnings
}

/** Install selected blueprints from a registered Ludus source (templates + ansible deps). */
export async function installSourceBlueprints(
  apiKey: string,
  sourceID: string,
  blueprintIds: string[],
): Promise<{ warnings: string[]; data: InstallResponse | null }> {
  const res = await ludusJson<InstallResponse>(
    `/sources/${encodeURIComponent(sourceID)}/install`,
    apiKey,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        selection: { blueprints: blueprintIds },
      }),
    },
  )
  if (!res.ok) {
    const msg =
      res.data?.error ||
      (typeof res.data === "object" && res.data && "result" in (res.data as object)
        ? String((res.data as { result?: string }).result)
        : null) ||
      `Source install failed (HTTP ${res.status})`
    throw new Error(msg)
  }
  return { warnings: collectInstallWarnings(res.data), data: res.data }
}

export function blueprintPublicId(sourceID: string, blueprintName: string): string {
  return `${sourceID}/${blueprintName}`
}

export function gitUrlForBadsectorlabs(): string {
  return BADSL_GIT_URL
}
