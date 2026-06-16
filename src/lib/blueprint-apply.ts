import { ludusApi } from "@/lib/api"
import { substituteRangeIdInConfig } from "@/lib/range-config-templates"

function isHttp404(error: string | undefined): boolean {
  if (!error) return false
  return /HTTP 404\b/i.test(error) || /\b404 Not Found\b/i.test(error)
}

function extractConfigYaml(data: unknown): string {
  const raw = data as { result?: string } | string | null | undefined
  if (typeof raw === "string") return raw
  return raw?.result ?? ""
}

export type BlueprintApplyMethod = "apply" | "config"

export interface BlueprintApplyResult {
  ok: boolean
  method?: BlueprintApplyMethod
  error?: string
  status: number
}

/**
 * Apply a blueprint to a range. Prefer Ludus POST /blueprints/{id}/apply (handles
 * {{ range_id }} substitution). Fall back to resolved YAML + PUT /range/config on 404.
 */
export async function applyBlueprintToRange(
  blueprintId: string,
  rangeId: string,
): Promise<BlueprintApplyResult> {
  const rid = rangeId.trim()
  if (!rid) {
    return { ok: false, error: "Range ID is required", status: 400 }
  }

  const applied = await ludusApi.applyBlueprint(blueprintId, rid)
  if (!applied.error) {
    return { ok: true, method: "apply", status: applied.status }
  }

  if (!isHttp404(applied.error)) {
    return { ok: false, error: applied.error, status: applied.status }
  }

  const cfg = await ludusApi.getBlueprintConfig(blueprintId)
  if (cfg.error || !cfg.data) {
    return {
      ok: false,
      error: cfg.error || applied.error || "Blueprint config fetch failed",
      status: cfg.status || applied.status,
    }
  }

  const yaml = substituteRangeIdInConfig(extractConfigYaml(cfg.data), rid)
  if (!yaml.trim()) {
    return { ok: false, error: "Blueprint config is empty", status: 400 }
  }

  const uploaded = await ludusApi.setRangeConfig(yaml, rid, true)
  if (uploaded.error) {
    return { ok: false, error: uploaded.error, status: uploaded.status }
  }

  return { ok: true, method: "config", status: uploaded.status }
}
