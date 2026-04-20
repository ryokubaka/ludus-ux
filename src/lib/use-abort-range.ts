/**
 * `useAbortRange` — single client entry point for aborting a Ludus range.
 *
 * Calls `POST /api/range/abort`, which in turn:
 *   1. Kills any in-flight GOAD SSH task for this range (when `goadTaskId` or
 *      `goadInstanceId` is provided).
 *   2. Asks Ludus to abort (user key → root admin fallback).
 *   3. Reconciles PocketBase `rangeState` directly if Ludus stays stuck.
 *
 * The hook handles the boring parts (impersonation headers, optimistic
 * `markRangeAborting` flag, query invalidation, success/error toast) so
 * the Dashboard + GOAD instance page just call `abortRange({ ... })`.
 *
 * Callers remain responsible for stopping their own streams (deploy log SSE,
 * GOAD PTY reader) because those live in page-local hooks. The server-side
 * kill step covers the actual SSH/ansible process.
 */

"use client"

import { useCallback, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { getImpersonationHeaders } from "@/lib/api"
import { markRangeAborting, clearRangeAborting } from "@/lib/range-aborting"
import { queryKeys } from "@/lib/query-keys"
import { useToast } from "@/hooks/use-toast"

export interface AbortRangeOptions {
  rangeId: string
  /** GOAD workspace instance id — scoped kill for any running task it owns. */
  goadInstanceId?: string | null
  /** Specific GOAD task id. Takes precedence over `goadInstanceId`. */
  goadTaskId?: string | null
}

export interface AbortRangeResult {
  success: boolean
  /** Task ids the server's cleanup registry successfully killed. */
  goadKilled: string[]
  /** Task ids the server flipped to "aborted" in SQLite. */
  goadMarkedAborted: string[]
  ludusAborted: boolean
  method: "user-abort" | "admin-abort" | "none"
  /** True when the server fell back to PocketBase to flip rangeState. */
  pbForced: boolean
  finalState?: string
  error?: string
}

export function useAbortRange() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [isAborting, setIsAborting] = useState(false)

  const abortRange = useCallback(
    async ({ rangeId, goadInstanceId, goadTaskId }: AbortRangeOptions): Promise<AbortRangeResult> => {
      setIsAborting(true)
      markRangeAborting(rangeId)

      try {
        const res = await fetch("/api/range/abort", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getImpersonationHeaders(),
          },
          body: JSON.stringify({
            rangeId,
            goadInstanceId: goadInstanceId ?? undefined,
            goadTaskId: goadTaskId ?? undefined,
          }),
        })

        const body = (await res.json().catch(() => ({}))) as Partial<AbortRangeResult>

        const result: AbortRangeResult = {
          success: !!body.success,
          goadKilled: body.goadKilled ?? [],
          goadMarkedAborted: body.goadMarkedAborted ?? [],
          ludusAborted: !!body.ludusAborted,
          method: (body.method as AbortRangeResult["method"]) ?? "none",
          pbForced: !!body.pbForced,
          finalState: body.finalState,
          error: body.error,
        }

        if (!result.success) {
          clearRangeAborting(rangeId)
          toast({
            variant: "destructive",
            title: "Abort failed",
            description:
              result.error ??
              "Neither Ludus nor the PocketBase fallback accepted the abort. Try again in a few seconds.",
          })
          return result
        }

        // Ask react-query to refetch the range card + GOAD task list immediately
        // so the UI swaps into the aborted state without waiting for the 15 s
        // background poll.
        queryClient.invalidateQueries({ queryKey: queryKeys.rangeStatus(rangeId) })
        queryClient.invalidateQueries({ queryKey: queryKeys.rangeStatus(null) })
        queryClient.invalidateQueries({ queryKey: queryKeys.goadTasks() })
        queryClient.invalidateQueries({ queryKey: queryKeys.rangeLogHistory(rangeId) })

        // Compose a friendly "what happened" line so the user knows when LUX
        // had to fall back to the PB writer (Ludus was stuck).
        const notes: string[] = []
        if (result.goadKilled.length > 0) notes.push("GOAD task stopped")
        if (result.method === "admin-abort") notes.push("admin abort used")
        if (result.pbForced) notes.push("state reconciled via PocketBase")

        toast({
          title: "Range aborted",
          description: notes.length ? notes.join(" · ") : undefined,
        })
        return result
      } catch (err) {
        clearRangeAborting(rangeId)
        const message = err instanceof Error ? err.message : String(err)
        toast({
          variant: "destructive",
          title: "Abort failed",
          description: message,
        })
        return {
          success: false,
          goadKilled: [],
          goadMarkedAborted: [],
          ludusAborted: false,
          method: "none",
          pbForced: false,
          error: message,
        }
      } finally {
        setIsAborting(false)
      }
    },
    [queryClient, toast],
  )

  return { abortRange, isAborting }
}
