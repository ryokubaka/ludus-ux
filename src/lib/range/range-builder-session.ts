"use client"

import type { QueryClient } from "@tanstack/react-query"
import { toast } from "@/hooks/use-toast"
import { ludusApi } from "@/lib/ui/api"
import { goadSidecarSyncBody } from "@/lib/ludus/ludus-extensions-config"
import { canonicalRangeYaml } from "@/lib/range/range-builder-document"
import { queryKeys } from "@/lib/ui/query-keys"

export interface RangeBuilderDraft {
  yaml: string
  baseline: string
}

const drafts = new Map<string, RangeBuilderDraft>()
const inflight = new Map<string, number>()
const listeners = new Set<() => void>()
let saveGeneration = 0

export function rangeBuilderDraftKey(scopeTag: string, rangeId: string): string {
  return `${scopeTag}\n${rangeId}`
}

export function readRangeBuilderDraft(key: string): RangeBuilderDraft | null {
  return drafts.get(key) ?? null
}

/** Keep a diagram that differs from the last saved copy. A clean document drops the draft. */
export function rememberRangeBuilderDraft(key: string, yaml: string, baseline: string): void {
  if (yaml === baseline) drafts.delete(key)
  else drafts.set(key, { yaml, baseline })
}

export function clearRangeBuilderDraft(key: string): void {
  drafts.delete(key)
}

/**
 * A draft stays only while the saved file is still the copy it was edited against.
 * A blueprint apply changes that file, so the draft must not be drawn in its place.
 */
export function draftAppliesToSaved(draft: RangeBuilderDraft | null, savedCanonical: string): boolean {
  if (!draft) return false
  try {
    if (canonicalRangeYaml(draft.baseline) !== savedCanonical) return false
    return canonicalRangeYaml(draft.yaml) !== savedCanonical
  } catch {
    return false
  }
}

/** Drop a draft only when it is the snapshot that just saved. Newer edits stay. */
export function draftAfterSave(current: RangeBuilderDraft | null, savedYaml: string): RangeBuilderDraft | null {
  if (!current || current.yaml === savedYaml) return null
  return { yaml: current.yaml, baseline: savedYaml }
}

function emitSaves(): void {
  for (const listener of listeners) listener()
}

export function subscribeRangeBuilderSaves(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function rangeBuilderSaveInFlight(rangeId: string | null): boolean {
  return rangeId != null && inflight.has(rangeId)
}

export function saveRangeBuilderConfig(input: {
  rangeId: string
  scopeTag: string
  yaml: string
  baseline: string
  force: boolean
  goadInstanceId: string | null
  queryClient: QueryClient
}): Promise<boolean> {
  const generation = ++saveGeneration
  inflight.set(input.rangeId, generation)
  emitSaves()
  toast({ title: "Saving range configuration…" })

  const stillCurrent = () => inflight.get(input.rangeId) === generation

  const finish = async (): Promise<boolean> => {
    const res = await ludusApi.setRangeConfig(input.yaml, input.rangeId, input.force)
    if (!stillCurrent()) return false
    if (res.error) {
      toast({ variant: "destructive", title: "Save failed", description: res.error })
      return false
    }
    const sidecarBody = input.goadInstanceId ? goadSidecarSyncBody(input.baseline, input.yaml) : null
    if (input.goadInstanceId && sidecarBody) {
      let syncResponse: Response
      try {
        syncResponse = await fetch(
          `/api/goad/instances/${encodeURIComponent(input.goadInstanceId)}/sync-network`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(sidecarBody),
          },
        )
      } catch (err) {
        toast({
          variant: "destructive",
          title: "Firewall sidecar not saved",
          description: err instanceof Error ? err.message : "Network error",
        })
        return false
      }
      const syncBody = (await syncResponse.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!stillCurrent()) return false
      if (!syncResponse.ok || syncBody.ok !== true) {
        toast({
          variant: "destructive",
          title: "Firewall sidecar not saved",
          description: syncBody.error || `Request failed (${syncResponse.status})`,
        })
        return false
      }
    }
    if (!stillCurrent()) return false
    const key = rangeBuilderDraftKey(input.scopeTag, input.rangeId)
    const nextDraft = draftAfterSave(readRangeBuilderDraft(key), input.yaml)
    if (nextDraft) drafts.set(key, nextDraft)
    else drafts.delete(key)
    input.queryClient.setQueryData(queryKeys.rangeConfig(input.scopeTag, input.rangeId), input.yaml)
    toast({ title: "Range configuration saved" })
    return true
  }

  const promise = finish().finally(() => {
    if (inflight.get(input.rangeId) === generation) {
      inflight.delete(input.rangeId)
      emitSaves()
    }
  })
  return promise
}
