import "server-only"

import yaml from "js-yaml"
import { buildLudusApiUrl } from "@/lib/ludus-source-client"
import { ludusBlueprintApiPath } from "@/lib/ludus-blueprint-proxy-path"
import { fetchAllRepoBlobs, fetchRepoRawFile } from "@/lib/template-repo-client"

export interface BlueprintManifest {
  id?: string
  name?: string
  description?: string
  version?: string
  tags?: string[]
  min_ludus_version?: string
  config?: string
}

export interface BlueprintRepoBundle {
  manifest: BlueprintManifest
  blueprintID: string
  rangeConfig: string
  requirementsYaml?: string
}

interface AnsibleResult {
  name?: string
  ok?: boolean
  error?: string
  type?: string
}

interface BlueprintCreatedResponse {
  result?: string
  blueprintID?: string
  error?: string
  ansibleResults?: AnsibleResult[]
}

interface RangeAccessEntry {
  rangeID?: string
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

export function isHttp404Error(err: unknown): boolean {
  const msg = (err as Error).message ?? String(err)
  return /HTTP 404\b/i.test(msg) || /\b404 Not Found\b/i.test(msg)
}

function relativeBlueprintPath(repoPath: string, blueprintRoot: string): string {
  const prefix = blueprintRoot.endsWith("/") ? blueprintRoot : `${blueprintRoot}/`
  if (repoPath === blueprintRoot) return repoPath.split("/").pop() ?? repoPath
  if (repoPath.startsWith(prefix)) return repoPath.slice(prefix.length)
  return repoPath.split("/").pop() ?? repoPath
}

function ludusError(data: unknown, status: number, fallback: string): string {
  if (data && typeof data === "object") {
    const o = data as { error?: string; result?: string; message?: string }
    return o.error || o.result || o.message || fallback
  }
  return fallback
}

function formatAnsibleResults(results: AnsibleResult[] | undefined): string {
  const failed = (results ?? []).filter((r) => r.ok === false)
  if (failed.length === 0) return ""
  return ` Ansible issues: ${failed.map((r) => `${r.name ?? "?"}${r.error ? `: ${r.error}` : ""}`).join("; ")}`
}

/** Fetch blueprint.yml + range-config (and optional requirements) from a git tree path. */
export async function loadBlueprintRepoBundle(
  apiBase: string,
  path: string,
  ref: string,
  expectedName?: string,
): Promise<BlueprintRepoBundle> {
  const blobs = await fetchAllRepoBlobs(apiBase, path, ref)
  if (blobs.length === 0) {
    throw new Error(`No files found under ${path}`)
  }

  const files = new Map<string, string>()
  await Promise.all(
    blobs.map(async (blob) => {
      const rel = relativeBlueprintPath(blob.path, path)
      const content = await fetchRepoRawFile(apiBase, blob.path, ref)
      files.set(rel.replace(/\\/g, "/"), content)
    }),
  )

  const manifestYaml = files.get("blueprint.yml")
  if (!manifestYaml) {
    throw new Error("Repository blueprint is missing blueprint.yml")
  }

  const manifest = yaml.load(manifestYaml) as BlueprintManifest
  const blueprintID = (manifest.id || expectedName || "").trim()
  if (!blueprintID) {
    throw new Error("blueprint.yml is missing id")
  }

  const configFile = (manifest.config || "range-config.yml").replace(/^\.?\//, "")
  const rangeConfig = files.get(configFile)
  if (!rangeConfig?.trim()) {
    throw new Error(`Blueprint config file "${configFile}" is missing or empty`)
  }

  return {
    manifest,
    blueprintID,
    rangeConfig,
    requirementsYaml: files.get("requirements.yml"),
  }
}

/** POST /blueprints — works on Ludus builds without /sources or /blueprints/import. */
export async function createBlueprintFromRepoBundle(
  apiKey: string,
  bundle: BlueprintRepoBundle,
): Promise<{ blueprintID: string; message: string }> {
  const { manifest, blueprintID, rangeConfig } = bundle
  const res = await ludusJson<BlueprintCreatedResponse>("/blueprints", apiKey, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      blueprintID,
      name: manifest.name,
      description: manifest.description,
      version: manifest.version,
      tags: manifest.tags,
      min_ludus_version: manifest.min_ludus_version,
      config: rangeConfig,
    }),
  })

  if (!res.ok) {
    throw new Error(
      ludusError(res.data, res.status, `Create blueprint failed (HTTP ${res.status})`),
    )
  }

  const id = res.data?.blueprintID || blueprintID
  let message =
    res.data?.result ||
    `Blueprint "${id}" created from repository files`
  message += formatAnsibleResults(res.data?.ansibleResults)
  return { blueprintID: id, message }
}

async function firstAccessibleRangeId(apiKey: string): Promise<string> {
  const res = await ludusJson<RangeAccessEntry[]>("/ranges/accessible", apiKey, { method: "GET" })
  if (!res.ok || !Array.isArray(res.data) || res.data.length === 0) {
    throw new Error(
      "No accessible range for blueprint bootstrap — deploy a range under your account first",
    )
  }
  const id = res.data[0]?.rangeID?.trim()
  if (!id) throw new Error("Could not resolve a range ID for blueprint bootstrap")
  return id
}

/** Same path as Blueprints page “Paste YAML” — for Ludus without POST /blueprints. */
export async function createBlueprintFromRangeBundle(
  apiKey: string,
  bundle: BlueprintRepoBundle,
): Promise<{ blueprintID: string; message: string }> {
  const { manifest, blueprintID, rangeConfig } = bundle
  const rangeID = await firstAccessibleRangeId(apiKey)

  const created = await ludusJson<BlueprintCreatedResponse>("/blueprints/from-range", apiKey, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      blueprintID,
      rangeID,
      name: manifest.name,
      description: manifest.description,
    }),
  })

  if (!created.ok) {
    throw new Error(
      ludusError(created.data, created.status, `from-range failed (HTTP ${created.status})`),
    )
  }

  const id = created.data?.blueprintID || blueprintID
  const updated = await ludusJson<{ result?: string; error?: string }>(
    ludusBlueprintApiPath(id, "config"),
    apiKey,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: rangeConfig }),
    },
  )

  if (!updated.ok) {
    throw new Error(
      ludusError(
        updated.data,
        updated.status,
        `Blueprint "${id}" created but config upload failed (HTTP ${updated.status})`,
      ),
    )
  }

  return {
    blueprintID: id,
    message: `Blueprint "${id}" created from repository (from-range + config upload)`,
  }
}
