import type { SourceInstallSelection } from "@/lib/ludus-source-client"

/** POST /api/sources/:id/install — set force to overwrite already-installed content. */
export async function postSourceInstall(
  sourceId: string,
  selection: SourceInstallSelection,
  options?: { force?: boolean },
): Promise<{ warnings: string[]; data: unknown }> {
  const res = await fetch(`/api/sources/${encodeURIComponent(sourceId)}/install`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      selection,
      ...(options?.force ? { force: true } : {}),
    }),
  })
  const json = (await res.json().catch(() => ({}))) as {
    error?: string
    warnings?: string[]
    data?: unknown
  }
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
  return { warnings: json.warnings ?? [], data: json.data }
}
