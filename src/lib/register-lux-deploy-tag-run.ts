import { getImpersonationHeaders } from "@/lib/api"

/** Tell LUX server about a tag-scoped deploy so history rows can be labeled. */
export async function registerLuxDeployTagRun(rangeId: string, tags: string[], requestedAt: number): Promise<void> {
  try {
    const res = await fetch("/api/range/deploy-tag-run", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getImpersonationHeaders() },
      body: JSON.stringify({ rangeId, tags, requestedAt }),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => "")
      console.warn("[registerLuxDeployTagRun]", res.status, t)
    }
  } catch (e) {
    console.warn("[registerLuxDeployTagRun]", e)
  }
}
