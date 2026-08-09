"use client"

import { useMemo } from "react"
import { useQueries, useQuery } from "@tanstack/react-query"
import { useEffectiveScopeTag } from "@/lib/effective-scope-context"
import { queryKeys } from "@/lib/query-keys"
import { STALE } from "@/lib/query-client"
import { mapRegisteredSources } from "@/lib/registered-ludus-sources"
import { fetchSourceCatalog, sourceCatalogItems } from "@/lib/source-catalog-client"
import {
  buildAnsibleSourceMatchMap,
  buildBlueprintSourceMatchMap,
  buildTemplateSourceMatchMap,
  lookupAnsibleSourceMatch,
  lookupBlueprintSourceMatch,
  lookupTemplateSourceMatch,
  type InstalledSourceMatch,
  type SourceCatalogRef,
} from "@/lib/source-installed-match"

type AnsibleInstalled = { name: string; version?: string }
type TemplateInstalled = { name: string; version?: string }
type BlueprintInstalled = {
  id: string
  name?: string
  sourceID?: string
  version?: string
}

/**
 * Join installed inventory to registered source catalogs for repo links + upgrade detection.
 */
export function useSourceInstalledProvenance(opts: {
  roles?: AnsibleInstalled[]
  collections?: AnsibleInstalled[]
  templates?: TemplateInstalled[]
  blueprints?: BlueprintInstalled[]
  enabled?: boolean
}) {
  const scopeTag = useEffectiveScopeTag()
  const enabled = opts.enabled !== false

  const { data: sourcesMeta, isLoading: sourcesLoading } = useQuery({
    queryKey: queryKeys.sources(scopeTag),
    queryFn: async () => {
      const res = await fetch("/api/sources")
      const json = await res.json()
      return {
        available: json.available !== false && res.ok,
        // Keep raw Ludus rows — same shape as Sources page / server prefetch (sourceID).
        sources: (json.sources ?? []) as Array<{
          sourceID?: string
          id?: string
          name?: string
          url?: string
          ref?: string
        }>,
      }
    },
    enabled,
    staleTime: STALE.long,
  })

  // Always normalize: prefetch / other pages cache `{ sourceID }` without mapped `.id`.
  const sources = useMemo(
    () => mapRegisteredSources(sourcesMeta?.sources ?? []),
    [sourcesMeta?.sources],
  )
  const sourcesAvailable = sourcesMeta?.available !== false && sources.length > 0

  const needRoles = (opts.roles?.length ?? 0) > 0
  const needCollections = (opts.collections?.length ?? 0) > 0
  const needTemplates = (opts.templates?.length ?? 0) > 0
  const needBlueprints = (opts.blueprints?.length ?? 0) > 0

  const roleQueries = useQueries({
    queries: sources.map((s) => ({
      queryKey: queryKeys.sourceRoles(scopeTag, s.id, s.ref),
      queryFn: () => fetchSourceCatalog<SourceCatalogRef>(s.id, "roles"),
      enabled: enabled && sourcesAvailable && needRoles,
      staleTime: STALE.short,
    })),
  })

  const collectionQueries = useQueries({
    queries: sources.map((s) => ({
      queryKey: queryKeys.sourceCollections(scopeTag, s.id, s.ref),
      queryFn: () => fetchSourceCatalog<SourceCatalogRef>(s.id, "collections"),
      enabled: enabled && sourcesAvailable && needCollections,
      staleTime: STALE.short,
    })),
  })

  const templateQueries = useQueries({
    queries: sources.map((s) => ({
      queryKey: queryKeys.sourceTemplates(scopeTag, s.id, s.ref),
      queryFn: () => fetchSourceCatalog<SourceCatalogRef>(s.id, "templates"),
      enabled: enabled && sourcesAvailable && needTemplates,
      staleTime: STALE.short,
    })),
  })

  const blueprintQueries = useQueries({
    queries: sources.map((s) => ({
      queryKey: queryKeys.sourceBlueprints(scopeTag, s.id, s.ref),
      queryFn: () => fetchSourceCatalog<SourceCatalogRef>(s.id, "blueprints"),
      enabled: enabled && sourcesAvailable && needBlueprints,
      staleTime: STALE.short,
    })),
  })

  const roleCatalogs = useMemo(
    () =>
      sources.map((s, i) => ({
        sourceId: s.id,
        items: sourceCatalogItems(roleQueries[i]?.data),
        pins: roleQueries[i]?.data?.pins,
      })),
    [sources, roleQueries],
  )
  const collectionCatalogs = useMemo(
    () =>
      sources.map((s, i) => ({
        sourceId: s.id,
        items: sourceCatalogItems(collectionQueries[i]?.data),
        pins: collectionQueries[i]?.data?.pins,
      })),
    [sources, collectionQueries],
  )
  const templateCatalogs = useMemo(
    () =>
      sources.map((s, i) => ({
        sourceId: s.id,
        items: sourceCatalogItems(templateQueries[i]?.data),
        pins: templateQueries[i]?.data?.pins,
      })),
    [sources, templateQueries],
  )
  const blueprintCatalogs = useMemo(
    () =>
      sources.map((s, i) => ({
        sourceId: s.id,
        items: sourceCatalogItems(blueprintQueries[i]?.data),
        pins: blueprintQueries[i]?.data?.pins,
      })),
    [sources, blueprintQueries],
  )

  const roleMap = useMemo(
    () =>
      buildAnsibleSourceMatchMap("role", roleCatalogs, sources, opts.roles ?? []),
    [roleCatalogs, sources, opts.roles],
  )
  const collectionMap = useMemo(
    () =>
      buildAnsibleSourceMatchMap(
        "collection",
        collectionCatalogs,
        sources,
        opts.collections ?? [],
      ),
    [collectionCatalogs, sources, opts.collections],
  )
  const templateMap = useMemo(
    () => buildTemplateSourceMatchMap(templateCatalogs, sources, opts.templates ?? []),
    [templateCatalogs, sources, opts.templates],
  )
  const blueprintMap = useMemo(
    () => buildBlueprintSourceMatchMap(blueprintCatalogs, sources, opts.blueprints ?? []),
    [blueprintCatalogs, sources, opts.blueprints],
  )

  const catalogsLoading =
    sourcesLoading ||
    roleQueries.some((q) => q.isLoading) ||
    collectionQueries.some((q) => q.isLoading) ||
    templateQueries.some((q) => q.isLoading) ||
    blueprintQueries.some((q) => q.isLoading)

  return {
    sourcesAvailable,
    isLoading: catalogsLoading,
    role: (name: string): InstalledSourceMatch | undefined =>
      lookupAnsibleSourceMatch(roleMap, name),
    collection: (name: string): InstalledSourceMatch | undefined =>
      lookupAnsibleSourceMatch(collectionMap, name),
    template: (name: string): InstalledSourceMatch | undefined =>
      lookupTemplateSourceMatch(templateMap, name),
    blueprint: (id: string): InstalledSourceMatch | undefined =>
      lookupBlueprintSourceMatch(blueprintMap, id),
  }
}
