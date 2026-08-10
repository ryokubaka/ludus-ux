"use client"

import { useMemo } from "react"
import { useQueries } from "@tanstack/react-query"
import { ludusApi } from "@/lib/api"
import { useEffectiveScopeTag } from "@/lib/effective-scope-context"
import { queryKeys } from "@/lib/query-keys"
import { STALE } from "@/lib/query-client"
import {
  buildInstalledBlueprintVersions,
  isMissingOrUnknownVersion,
} from "@/lib/source-catalog-presence"
import type { BlueprintListItem } from "@/lib/types"

function aliasKeysForBlueprintId(id: string): string[] {
  const keys = [id]
  const parts = id.split("/").filter(Boolean)
  if (parts.length > 0) keys.push(parts[parts.length - 1]!)
  if (parts.length >= 2) {
    keys.push(`${parts[parts.length - 2]}/${parts[parts.length - 1]}`)
  }
  return keys
}

/**
 * Ludus GET /blueprints often omits version — fill from GET /blueprints/{id} detail.
 */
export function useInstalledBlueprintVersions(blueprints: BlueprintListItem[]): Map<string, string> {
  const scopeTag = useEffectiveScopeTag()

  const needingDetail = useMemo(
    () =>
      blueprints.filter(
        (bp) =>
          !!(bp.id || bp.blueprintID)?.trim() && isMissingOrUnknownVersion(bp.version),
      ),
    [blueprints],
  )

  const detailQueries = useQueries({
    queries: needingDetail.map((bp) => {
      const id = (bp.id || bp.blueprintID || "").trim()
      return {
        queryKey: queryKeys.blueprintDetail(scopeTag, id),
        queryFn: async () => {
          const result = await ludusApi.getBlueprintDetail(id)
          const data = result.data as { version?: string; Version?: string } | null | undefined
          const version = (data?.version || data?.Version || "").trim() || undefined
          return { id, version }
        },
        staleTime: STALE.medium,
        enabled: !!id,
      }
    }),
  })

  return useMemo(() => {
    const map = buildInstalledBlueprintVersions(blueprints)
    for (const q of detailQueries) {
      const id = q.data?.id?.trim()
      const version = q.data?.version?.trim()
      if (!id || !version) continue
      for (const key of aliasKeysForBlueprintId(id)) {
        if (key && !map.has(key)) map.set(key, version)
      }
    }
    return map
  }, [blueprints, detailQueries])
}
