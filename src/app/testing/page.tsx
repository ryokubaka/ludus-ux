"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { STALE } from "@/lib/query-client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { LogViewer } from "@/components/range/log-viewer"
import {
  Shield,
  ShieldOff,
  Plus,
  Trash2,
  RefreshCw,
  Loader2,
  Globe,
  Network,
  AlertTriangle,
  Camera,
  Activity,
  ScrollText,
  Server,
  Clock,
} from "lucide-react"
import Link from "next/link"
import { ludusApi, getImpersonationHeaders } from "@/lib/api"
import type { RangeObject } from "@/lib/types"
import type { RangeOp, RangeOpStatus } from "@/lib/range-op-store"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { useConfirm } from "@/hooks/use-confirm"
import { ConfirmBar } from "@/components/ui/confirm-bar"
import { useImpersonation } from "@/lib/impersonation-context"
import { useRange } from "@/lib/range-context"

// ── parseEntry lives outside the component (pure, no deps) ───────────────────

/** Parse a raw allowedDomains entry back into { type, raw, display }. */
function parseEntry(entry: string): { type: "domain" | "ip"; raw: string; display: string } {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(entry.trim())) {
    return { type: "ip", raw: entry.trim(), display: entry.trim() }
  }
  const m = entry.match(/^([^\s(]+)\s*(\(.*\))?$/)
  const domain = m ? m[1] : entry.trim()
  return { type: "domain", raw: domain, display: entry.trim() }
}

// ── DB-backed pending allow/deny helpers ─────────────────────────────────────
// Calls our Next.js API route at /api/range/pending-allows which persists
// pending ops in SQLite.  State survives logout, browser switch, restarts.
// The server GET endpoint also reconciles pending ops against the live Ludus
// allowedDomains list, so the client never needs to reconcile locally.

async function fetchPendingAllows(
  rangeId: string,
  impHeaders: Record<string, string>,
): Promise<{ adds: string[]; removes: string[] }> {
  try {
    const res = await fetch(
      `/api/range/pending-allows?rangeId=${encodeURIComponent(rangeId)}`,
      { headers: { ...impHeaders } },
    )
    if (!res.ok) {
      console.error("[pending-allows] GET failed:", res.status, await res.text().catch(() => ""))
      return { adds: [], removes: [] }
    }
    const data = await res.json()
    return data
  } catch (err) {
    console.error("[pending-allows] GET error:", err)
    return { adds: [], removes: [] }
  }
}

async function postPendingAllow(
  rangeId: string,
  entry: string,
  opType: "add" | "remove",
  impHeaders: Record<string, string>,
): Promise<boolean> {
  try {
    const res = await fetch("/api/range/pending-allows", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...impHeaders },
      body: JSON.stringify({ rangeId, entry, opType }),
    })
    if (!res.ok) {
      console.error("[pending-allows] POST failed:", res.status, await res.text().catch(() => ""))
      return false
    }
    return true
  } catch (err) {
    console.error("[pending-allows] POST error:", err)
    return false
  }
}

async function fetchAllowedDomains(
  rangeId: string,
  impHeaders: Record<string, string>,
): Promise<string[]> {
  try {
    const res = await fetch(
      `/api/range/allowed-domains?rangeId=${encodeURIComponent(rangeId)}`,
      { headers: { ...impHeaders } },
    )
    if (!res.ok) return []
    const data = await res.json()
    return data.allowedDomains ?? []
  } catch {
    return []
  }
}

async function deletePendingAllows(
  rangeId: string,
  entries: string[],
  opType: "add" | "remove",
  impHeaders: Record<string, string>,
): Promise<void> {
  if (entries.length === 0) return
  try {
    await fetch("/api/range/pending-allows", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", ...impHeaders },
      body: JSON.stringify({ rangeId, entries, opType }),
    })
  } catch {}
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function TestingPage() {
  const { toast } = useToast()
  const { impersonation } = useImpersonation()
  const { pendingAction, confirm, cancelConfirm, commitConfirm } = useConfirm()

  // ── Global range context — single source of truth for which range is active.
  // selectedRangeId is persisted to sessionStorage and shared with the sidebar,
  // so changing the range anywhere in the app instantly updates this page too.
  const {
    ranges: contextRanges,   // RangeAccessEntry[] — same list as the sidebar
    selectedRangeId,         // string | null — driven by sidebar & local selector
    selectRange,             // updates global context + sessionStorage
    loading: rangesLoading,
  } = useRange()

  // ── Supplemental per-range data (testingEnabled dots in selector) ─────────
  // Uses PocketBase-backed endpoint so testingEnabled status stays accurate
  // without depending on the Ludus API, which can cache stale values.
  const impersonatedUser = impersonation?.username ?? "self"
  const { data: rangesData } = useQuery({
    queryKey: ["ranges", "user", "pb", impersonatedUser],
    queryFn: async () => {
      const res = await fetch("/api/range/pb-status", {
        headers: { ...getImpersonationHeaders() },
      })
      if (!res.ok) {
        // Fall back to Ludus API on error
        return ludusApi.getRangesForUser().then((r) => r.data ?? [])
      }
      return res.json() as Promise<RangeObject[]>
    },
    staleTime: STALE.short,
  })

  // Ref so closures (effects, intervals, callbacks) always read the LATEST
  // selectedRangeId without needing it in every dependency array.
  const selectedRangeIdRef = useRef<string | null>(null)
  useEffect(() => { selectedRangeIdRef.current = selectedRangeId }, [selectedRangeId])

  // ── Per-range status ──────────────────────────────────────────────────────
  const [status, setStatus] = useState<RangeObject | null>(null)
  const [statusLoading, setStatusLoading] = useState(false)
  const [toggling, setToggling] = useState(false)

  // ── Allowed domains (fetched via dedicated endpoint) ─────────────────────
  // Uses /api/range/allowed-domains which queries both the standard Ludus API
  // and the admin API (root key) as fallback.  This is more reliable than
  // relying on status.allowedDomains from GET /range, which sometimes comes
  // back empty due to the Ludus/PocketBase sync bug.
  const [serverAllowedDomains, setServerAllowedDomains] = useState<string[]>([])

  const refreshAllowedDomains = useCallback(async (rangeId: string) => {
    const domains = await fetchAllowedDomains(rangeId, getImpersonationHeaders())
    if (selectedRangeIdRef.current === rangeId) {
      setServerAllowedDomains(domains)
    }
    return domains
  }, [])

  // ── Persistent pending allow/deny tracking ────────────────────────────────
  const [pendingAdds, setPendingAdds]       = useState<string[]>([])
  const [pendingRemoves, setPendingRemoves] = useState<string[]>([])
  const hasPendingOps = pendingAdds.length > 0 || pendingRemoves.length > 0

  const refreshPending = useCallback(async (rangeId: string) => {
    const result = await fetchPendingAllows(rangeId, getImpersonationHeaders())
    if (selectedRangeIdRef.current === rangeId) {
      setPendingAdds(result.adds)
      setPendingRemoves(result.removes)
    }
  }, [])

  /**
   * Client-side reconciliation: compare pending state against the live
   * allowedDomains fetched from the dedicated endpoint (which tries the
   * admin API as a fallback).
   */
  const reconcilePending = useCallback(async (
    rangeId: string,
    liveDomains: string[],
    currentAdds: string[],
    currentRemoves: string[],
  ) => {
    const serverRaws = liveDomains.map(e => parseEntry(e).raw)
    const impHeaders = getImpersonationHeaders()

    const confirmedAdds = currentAdds.filter(a => serverRaws.includes(a))
    const confirmedRemoves = currentRemoves.filter(r => !serverRaws.includes(r))

    if (confirmedAdds.length > 0) {
      await deletePendingAllows(rangeId, confirmedAdds, "add", impHeaders)
      setPendingAdds((prev: string[]) => prev.filter(a => !confirmedAdds.includes(a)))
    }
    if (confirmedRemoves.length > 0) {
      await deletePendingAllows(rangeId, confirmedRemoves, "remove", impHeaders)
      setPendingRemoves((prev: string[]) => prev.filter(r => !confirmedRemoves.includes(r)))
    }
  }, [])

  // Load pending ops + allowed domains when the selected range changes
  useEffect(() => {
    if (!selectedRangeId) {
      setPendingAdds([]); setPendingRemoves([]); setServerAllowedDomains([])
      return
    }
    refreshPending(selectedRangeId)
    refreshAllowedDomains(selectedRangeId)
  }, [selectedRangeId, refreshPending, refreshAllowedDomains])

  // Auto-poll while pending ops are outstanding
  useEffect(() => {
    if (!hasPendingOps || !selectedRangeId) return
    const id = setInterval(async () => {
      const rangeId = selectedRangeIdRef.current
      if (!rangeId) return

      const [domains, pendingResult] = await Promise.all([
        fetchAllowedDomains(rangeId, getImpersonationHeaders()),
        fetchPendingAllows(rangeId, getImpersonationHeaders()),
      ])

      if (selectedRangeIdRef.current !== rangeId) return

      setServerAllowedDomains(domains)
      setPendingAdds(pendingResult.adds)
      setPendingRemoves(pendingResult.removes)

      if (pendingResult.adds.length > 0 || pendingResult.removes.length > 0) {
        await reconcilePending(rangeId, domains, pendingResult.adds, pendingResult.removes)
      }
    }, 3000)
    return () => clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPendingOps, selectedRangeId])

  // ── Derived displayed list ────────────────────────────────────────────────
  // (server list − pendingRemoves) ∪ pendingAdds not yet on server
  const displayedAllowed = useMemo(() => {
    return [
      ...serverAllowedDomains.filter(
        (e: string) => !pendingRemoves.some((r: string) => r === parseEntry(e).raw)
      ),
      ...pendingAdds.filter(
        (add: string) => !serverAllowedDomains.some((s: string) => parseEntry(s).raw === add)
      ),
    ]
  }, [serverAllowedDomains, pendingAdds, pendingRemoves])

  // DB-backed operation tracking — persists across page refreshes.
  // null = no active op;  object = op is pending or running
  const [activeOp, setActiveOp] = useState<Pick<RangeOp, "id" | "opType" | "status" | "startedAt"> | null>(null)

  // Elapsed-time ticker state (effect is placed after opInProgress is derived below)
  const [elapsedSec, setElapsedSec] = useState(0)

  // ── Log panel ─────────────────────────────────────────────────────────────
  const [showLogs, setShowLogs] = useState(false)
  const [logLines, setLogLines] = useState<string[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const abortRef        = useRef<AbortController | null>(null)
  // Refs so async callbacks can read latest values without stale closures
  const isStreamingRef  = useRef(false)
  // Ref to latest startLogStream — breaks the pollOp ↔ startLogStream circular dep
  const startLogStreamRef = useRef<((rangeId: string) => void) | null>(null)

  // Keep the ref in sync so async closures always read the latest value
  useEffect(() => { isStreamingRef.current = isStreaming }, [isStreaming])

  // Ref for tracking activeOp transitions — declared here, effect added below
  // (after fetchStatus is defined) to avoid "used before declaration" errors.
  const prevActiveOpRef = useRef(activeOp)

  // ── Derived state ─────────────────────────────────────────────────────────
  const rangeState   = status?.rangeState ?? ""
  const isDeploying  = rangeState === "DEPLOYING" || rangeState === "WAITING"
  const isEnabled    = status?.testingEnabled ?? false
  const opInProgress = !!activeOp && (activeOp.status === "pending" || activeOp.status === "running")
  // True while we should lock the button and show progress UI
  const isInProgress = toggling || opInProgress || isDeploying

  // Elapsed-time ticker — updates every second while an op is in-flight so the
  // UI shows "Xm Ys" rather than a static "waiting…" message.
  // Placed here (after opInProgress) to avoid a temporal dead zone error.
  useEffect(() => {
    if (!opInProgress || !activeOp) { setElapsedSec(0); return }
    const startMs = activeOp.startedAt
    const id = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startMs) / 1000))
    }, 1000)
    return () => clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opInProgress, activeOp?.startedAt])

  // ── Fetch helpers ─────────────────────────────────────────────────────────


  /**
   * Fetch range status — PocketBase first, Ludus API as fallback.
   *
   * PocketBase is the authoritative store for testingEnabled and rangeState.
   * Going there directly avoids Ludus caching delays that caused the status
   * to appear "stuck" after a testing-mode toggle completed.
   */
  const fetchStatus = useCallback(async (rangeId?: string) => {
    setStatusLoading(true)
    try {
      const url = rangeId
        ? `/api/range/pb-status?rangeId=${encodeURIComponent(rangeId)}`
        : "/api/range/pb-status"
      const res = await fetch(url, { headers: { ...getImpersonationHeaders() } })

      if (res.ok) {
        const data: RangeObject = await res.json()
        if (!rangeId || selectedRangeIdRef.current === rangeId) {
          setStatus(data)
        }
      } else {
        // PocketBase route failed — fall back to Ludus API
        const result = await ludusApi.getRangeStatus(rangeId)
        if (result.data && (!rangeId || selectedRangeIdRef.current === rangeId)) {
          setStatus(result.data)
        }
      }
    } catch {
      // Non-fatal; keep showing the last known status
    } finally {
      setStatusLoading(false)
    }
  }, [])

  // When activeOp transitions from a set value to null (meaning the op just
  // completed and getActiveRangeOp no longer returns it), refresh the range
  // status immediately so isEnabled / button labels update without a manual refresh.
  useEffect(() => {
    const prev = prevActiveOpRef.current
    prevActiveOpRef.current = activeOp
    if (prev && !activeOp && selectedRangeId) {
      fetchStatus(selectedRangeId)
    }
  }, [activeOp, selectedRangeId, fetchStatus])

  /**
   * Poll the server for the current DB op for `rangeId`.
   * The server also runs a Ludus state check and auto-completes the op when the
   * expected outcome is detected.  If the op is still in progress and no stream
   * is running, this function starts (or restarts) the log stream so logs are
   * always visible while an operation is active.
   */
  const pollOp = useCallback(async (rangeId: string) => {
    try {
      const res = await fetch(`/api/range/ops?rangeId=${encodeURIComponent(rangeId)}`, {
        headers: { "Content-Type": "application/json", ...getImpersonationHeaders() },
      })
      if (!res.ok) return
      const { op } = await res.json() as { op: typeof activeOp | null }

      setActiveOp(op)

      if (!op) return

      if (op.status === "completed" || op.status === "error") {
        // Op finished — refresh range status so button label / badge updates
        await fetchStatus(rangeId)
      } else {
        // Op still in flight — ensure the log stream is running so the user
        // sees live output.  Use the ref to avoid circular useCallback deps.
        if (!isStreamingRef.current) {
          setShowLogs(true)
          startLogStreamRef.current?.(rangeId)
        }
      }
    } catch {
      // Non-fatal; next poll will retry
    }
  }, [fetchStatus])

  // ── Log streaming ─────────────────────────────────────────────────────────

  const startLogStream = useCallback((rangeId: string, snapshotStart = false) => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setIsStreaming(true)

    ;(async () => {
      try {
        const url = `/api/logs/stream?rangeId=${encodeURIComponent(rangeId)}${snapshotStart ? "&snapshotStart=true" : ""}`
        const res = await fetch(
          url,
          { signal: ctrl.signal, headers: { ...getImpersonationHeaders() } }
        )
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
        const reader = res.body.getReader()
        const dec    = new TextDecoder()

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk    = dec.decode(value, { stream: true })
          const newLines = chunk
            .split("\n")
            .filter((l) => l.startsWith("data: "))
            .map((l) => l.slice(6))
          // Filter out internal sentinel lines — show only real log content
          // Filter out internal control lines — never show them as log output
          const displayLines = newLines.filter(
            (l) => !l.startsWith("[DONE] ") && !l.startsWith("[STATE] ")
          )
          if (displayLines.length) setLogLines((prev) => [...prev, ...displayLines])

          // [DONE] <state> — new sentinel; also accept legacy [DEPLOY_COMPLETE]
          if (newLines.some((l) => l.startsWith("[DONE] ") || l.includes("[DEPLOY_COMPLETE]"))) {
            // Stream confirmed completion — do a final poll so DB gets updated
            if (rangeId) await pollOp(rangeId)
            break
          }
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return
      } finally {
        setIsStreaming(false)
        // Always do one final poll when the stream ends (handles the case where
        // [DEPLOY_COMPLETE] was sent but the check above missed it, or the
        // stream was closed server-side after the op completed).
        await pollOp(rangeId)
      }
    })()
  }, [pollOp])

  // Keep the ref to startLogStream current so pollOp can call it without a
  // circular useCallback dependency.
  useEffect(() => { startLogStreamRef.current = startLogStream }, [startLogStream])

  // ── Mount / range change ──────────────────────────────────────────────────

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  // When selected range changes: reset all per-range UI state, then load
  // the live status, allowed domains, and any active DB op simultaneously.
  useEffect(() => {
    if (!selectedRangeId) return
    setStatus(null)
    setActiveOp(null)
    setLogLines([])
    setShowLogs(false)
    setIsStreaming(false)
    setServerAllowedDomains([])
    abortRef.current?.abort()

    fetchStatus(selectedRangeId)
    refreshAllowedDomains(selectedRangeId)
    pollOp(selectedRangeId)
  }, [selectedRangeId, fetchStatus, refreshAllowedDomains, pollOp])

  // When an op is in progress, always show the log panel so the user sees progress.
  useEffect(() => {
    if (opInProgress) setShowLogs(true)
  }, [opInProgress])

  // Poll DB op every 3 s while an operation is in progress.
  // pollOp also drives stream restarts — if the stream terminated while the op
  // is still running (e.g. Ludus hadn't started DEPLOYING yet), the next poll
  // will restart the stream automatically.
  useEffect(() => {
    if (!selectedRangeId || !opInProgress) return
    const id = setInterval(() => pollOp(selectedRangeId), 3000)
    return () => clearInterval(id)
  }, [selectedRangeId, opInProgress, pollOp])

  // ── Toggle testing mode ───────────────────────────────────────────────────

  const doToggle = async () => {
    if (!selectedRangeId) return
    setToggling(true)
    setShowLogs(true)
    setLogLines([])

    const opType = isEnabled ? "testing_stop" : "testing_start"

    // Start streaming BEFORE the API call — the Ludus PUT request can block
    // for 30 s to 5 min while Proxmox jobs are already running and writing
    // logs.  Starting after the await would miss all of that output.
    // Note: for testing-mode ops, rangeState never enters DEPLOYING, so the
    // stream relies on its warmup window to stay open and collect logs.
    startLogStream(selectedRangeId)

    // POST to our API route which creates the DB record AND calls Ludus.
    // Using fetch directly so we can inject impersonation headers that apiRequest
    // would add but aren't in the ludusApi helper set.
    const res = await fetch("/api/range/ops", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getImpersonationHeaders() },
      body: JSON.stringify({ rangeId: selectedRangeId, opType }),
    })

    const data = await res.json()

    if (!res.ok) {
      toast({ variant: "destructive", title: "Error", description: data.error || "Unknown error" })
      setShowLogs(false)
      abortRef.current?.abort()
      setToggling(false)
      return
    }

    setActiveOp(data.op)
    setToggling(false)

    toast({
      title: isEnabled ? "Reverting VMs…" : "Snapshotting VMs…",
      description: "Proxmox is working. The UI will watch for completion automatically — this may take several minutes on slower hardware.",
    })
    // Stream is already running — no need to start it again here.
  }

  const handleToggle = () =>
    confirm(
      isEnabled
        ? "Stop Testing Mode? All VMs will be reverted to their pre-testing snapshots."
        : "Start Testing Mode? All VMs will be snapshotted and internet access will be blocked.",
      doToggle
    )

  // ── Domain / IP helpers ───────────────────────────────────────────────────
  //
  // The Ludus API stores a single unified "allowedDomains" list in PocketBase.
  // Entries look like "domain.com (1.2.3.4)" (domain + resolved IP) or just
  // "8.8.8.8" (bare IP). There is no separate allowedIPs field in the API.
  //
  // Allow:  POST /testing/allow  { domains: [...] }  or  { ips: [...] }
  // Deny:   POST /testing/deny   { domains: [...] }  or  { ips: [...] }
  //
  // Wildcards (*.example.com) are NOT supported — Ludus does a real DNS lookup.
  // CIDR notation (1.2.3.0/24) is NOT supported — only exact IPs are accepted.
  // parseEntry() is defined at module level above the component.

  const [newEntry, setNewEntry] = useState("")
  const [addingEntry, setAddingEntry] = useState(false)
  // Tracks which entry is currently being removed so we can show inline loading
  const [removingEntry, setRemovingEntry] = useState<string | null>(null)

  const doAllow = async () => {
    const val = newEntry.trim()
    if (!val || !selectedRangeId) return
    setAddingEntry(true)
    const rangeId = selectedRangeIdRef.current ?? selectedRangeId

    // Show the log panel immediately so the user sees activity while Ludus
    // resolves the domain IP and applies the firewall rule (can take 1-2 min).
    // snapshotStart=true skips pre-existing deployment logs so the panel only
    // shows output written after this allow operation begins.
    setShowLogs(true)
    setLogLines([])
    startLogStream(rangeId, true)

    // Write to our DB FIRST so the pending state is durable even if the
    // browser is closed or Ludus is slow.
    const saved = await postPendingAllow(rangeId, val, "add", getImpersonationHeaders())
    if (saved) {
      setPendingAdds((prev: string[]) => prev.includes(val) ? prev : [...prev, val])
      setNewEntry("")
    }

    const isIP = /^\d+\.\d+\.\d+\.\d+$/.test(val)
    const result = isIP
      ? await ludusApi.allowIP(val, selectedRangeId)
      : await ludusApi.allowDomain(val, selectedRangeId)

    type AllowResp = { allowed?: string[]; errors?: { item: string; reason: string }[] }
    const data = result.data as AllowResp | undefined
    const apiErrors = data?.errors?.filter(e => e.reason !== "already allowed")

    if (result.error) {
      toast({ variant: "destructive", title: "Error", description: result.error })
    } else if (apiErrors?.length) {
      toast({
        variant: "destructive",
        title: `Could not allow ${isIP ? "IP" : "domain"}`,
        description: apiErrors.map(e => `${e.item}: ${e.reason}`).join("; "),
      })
    } else {
      toast({ title: `${isIP ? "IP" : "Domain"} allowed` })
    }
    setAddingEntry(false)
    // Refresh allowed domains and pending, then reconcile
    const impHeaders = getImpersonationHeaders()
    const [freshDomains, freshPending] = await Promise.all([
      fetchAllowedDomains(rangeId, impHeaders),
      fetchPendingAllows(rangeId, impHeaders),
    ])
    if (selectedRangeIdRef.current === rangeId) {
      setServerAllowedDomains(freshDomains)
      setPendingAdds(freshPending.adds)
      setPendingRemoves(freshPending.removes)
      await reconcilePending(rangeId, freshDomains, freshPending.adds, freshPending.removes)
    }
  }

  const handleAllow = () => {
    const val = newEntry.trim()
    if (!val) return
    const isIP = /^\d+\.\d+\.\d+\.\d+$/.test(val)
    confirm(
      `Allow ${isIP ? "IP" : "domain"} "${val}"? This will add a firewall rule permitting outbound traffic.`,
      doAllow,
    )
  }

  const doDenyEntry = async (entry: string) => {
    if (!selectedRangeId) return
    setRemovingEntry(entry)
    const { type, raw } = parseEntry(entry)
    const rangeId = selectedRangeIdRef.current ?? selectedRangeId

    // Show the log panel immediately so the user sees Ludus applying the
    // firewall rule removal. snapshotStart=true skips pre-existing logs.
    setShowLogs(true)
    setLogLines([])
    startLogStream(rangeId, true)

    // Write to our DB FIRST so the pending state is durable
    const saved = await postPendingAllow(rangeId, raw, "remove", getImpersonationHeaders())
    if (saved) {
      setPendingRemoves((prev: string[]) => prev.includes(raw) ? prev : [...prev, raw])
    }

    const result = type === "ip"
      ? await ludusApi.denyIP(raw, selectedRangeId)
      : await ludusApi.denyDomain(raw, selectedRangeId)

    type DenyResp = { denied?: string[]; errors?: { item: string; reason: string }[] }
    const data = result.data as DenyResp | undefined
    const apiErrors = data?.errors

    if (result.error) {
      toast({ variant: "destructive", title: "Error", description: result.error })
    } else if (apiErrors?.length) {
      toast({
        variant: "destructive",
        title: "Could not remove rule",
        description: apiErrors.map(e => `${e.item}: ${e.reason}`).join("; "),
      })
    } else {
      toast({ title: "Rule removed" })
    }
    setRemovingEntry(null)
    // Refresh allowed domains and pending, then reconcile
    const impHeaders = getImpersonationHeaders()
    const [freshDomains, freshPending] = await Promise.all([
      fetchAllowedDomains(rangeId, impHeaders),
      fetchPendingAllows(rangeId, impHeaders),
    ])
    if (selectedRangeIdRef.current === rangeId) {
      setServerAllowedDomains(freshDomains)
      setPendingAdds(freshPending.adds)
      setPendingRemoves(freshPending.removes)
      await reconcilePending(rangeId, freshDomains, freshPending.adds, freshPending.removes)
    }
  }

  const handleDenyEntry = (entry: string) =>
    confirm(`Remove allow-rule for "${parseEntry(entry).raw}"?`, () => doDenyEntry(entry))

  // ── Derived UI labels ─────────────────────────────────────────────────────

  const selectedRange = contextRanges.find((r) => r.rangeID === selectedRangeId)

  const isStopping = activeOp?.opType === "testing_stop" || (opInProgress && isEnabled)
  const progressLabel =
    isDeploying   ? "Processing…"
    : isStopping  ? "Stopping…"
    : opInProgress ? "Starting…"
    : ""

  const statusBadgeExtra: { label: string; variant: "info" | "secondary" } | null =
    isDeploying          ? { label: "PROCESSING", variant: "info" }
    : opInProgress       ? { label: "QUEUED",     variant: "secondary" }
    : null

  const opStatusLabel: RangeOpStatus | null = activeOp?.status ?? null

  return (
    <div className="max-w-3xl space-y-6">
      <ConfirmBar pending={pendingAction} onConfirm={commitConfirm} onCancel={cancelConfirm} />

      {/* Range selector — shown when user has multiple ranges */}
      {rangesLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading ranges…
        </div>
      ) : contextRanges.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {contextRanges.map((r) => {
            // Look up full RangeObject for per-range status indicators (dots)
            const rangeStatus = rangesData?.find((rd) => rd.rangeID === r.rangeID)
            return (
              <button
                key={r.rangeID}
                onClick={() => selectRange(r.rangeID)}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-mono transition-colors",
                  selectedRangeId === r.rangeID
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/30 hover:text-foreground"
                )}
              >
                <Server className="h-3.5 w-3.5" />
                {r.rangeID}
                {rangeStatus?.testingEnabled && (
                  <span className="inline-block h-2 w-2 rounded-full bg-yellow-400" title="Testing enabled" />
                )}
                {(rangeStatus?.rangeState === "DEPLOYING" || rangeStatus?.rangeState === "WAITING") && (
                  <span className="inline-block h-2 w-2 rounded-full bg-blue-400 animate-pulse" title="Deploying" />
                )}
              </button>
            )
          })}
        </div>
      )}

      {!selectedRangeId && !rangesLoading && (
        <Alert><AlertDescription>No ranges found. Deploy a range first.</AlertDescription></Alert>
      )}

      {selectedRangeId && (
        <>
          {/* ── Status card ── */}
          <Card className={cn(
            "border-2 transition-colors",
            isInProgress ? "border-blue-500/50" : isEnabled ? "border-yellow-500/50" : "border-border",
          )}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between flex-wrap gap-4">
                {/* Icon */}
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "h-10 w-10 rounded-full flex items-center justify-center flex-shrink-0",
                    isInProgress ? "bg-blue-500/20" : isEnabled ? "bg-yellow-500/20" : "bg-muted"
                  )}>
                    {isInProgress
                      ? <Activity className="h-5 w-5 text-blue-400 animate-pulse" />
                      : isEnabled
                      ? <Shield  className="h-5 w-5 text-yellow-400" />
                      : <ShieldOff className="h-5 w-5 text-muted-foreground" />
                    }
                  </div>
                  <div>
                    <p className="font-semibold text-sm">
                      Testing Mode
                      {selectedRange && contextRanges.length > 1 && (
                        <span className="ml-2 font-mono text-xs text-muted-foreground font-normal">
                          ({selectedRange.rangeID})
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {isDeploying
                        ? "Range is actively processing — VMs are being snapshotted or reverted"
                        : opInProgress
                        ? (() => {
                            const m = Math.floor(elapsedSec / 60)
                            const s = elapsedSec % 60
                            const elapsed = m > 0 ? `${m}m ${s}s` : `${s}s`
                            const verb = activeOp?.opType === "testing_start" ? "Snapshotting" : "Reverting"
                            return `${verb} VMs on Proxmox — watching for completion… (${elapsed})`
                          })()
                        : isEnabled
                        ? "VMs are snapshotted and internet access is blocked"
                        : "VMs have normal internet access"}
                    </p>
                  </div>
                </div>

                {/* Badges */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {statusBadgeExtra && (
                    <Badge variant={statusBadgeExtra.variant} className="animate-pulse gap-1">
                      {statusBadgeExtra.variant === "secondary" && <Clock className="h-3 w-3" />}
                      {statusBadgeExtra.label}
                    </Badge>
                  )}
                  <Badge variant={isInProgress ? "secondary" : isEnabled ? "warning" : "secondary"}>
                    {statusLoading ? "…" : isEnabled ? "ENABLED" : "DISABLED"}
                  </Badge>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex gap-3 mt-4">
                <Button
                  onClick={handleToggle}
                  disabled={isInProgress || statusLoading || !!pendingAction}
                  variant={isEnabled ? "destructive" : "default"}
                  className="min-w-52"
                >
                  {isInProgress ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : isEnabled ? (
                    <ShieldOff className="h-4 w-4" />
                  ) : (
                    <Camera className="h-4 w-4" />
                  )}
                  {isInProgress
                    ? progressLabel
                    : isEnabled
                    ? "Stop Testing (Revert VMs)"
                    : "Start Testing (Snapshot VMs)"}
                </Button>
                <Button variant="ghost" onClick={() => fetchStatus(selectedRangeId ?? undefined)} disabled={statusLoading} title="Refresh">
                  <RefreshCw className={cn("h-4 w-4", statusLoading && "animate-spin")} />
                </Button>
              </div>

              {/* Contextual alerts */}
              {isDeploying && (
                <Alert className="mt-4 border-blue-500/30 bg-blue-500/5">
                  <Activity className="h-4 w-4 text-blue-400" />
                  <AlertDescription className="text-xs">
                    Range is actively processing. Logs are streaming below — or visit{" "}
                    <Link href="/logs" className="text-primary underline">Range Logs</Link> for the full history.
                  </AlertDescription>
                </Alert>
              )}
              {opInProgress && (
                <Alert className="mt-4 border-blue-500/20 bg-blue-500/5">
                  <Clock className="h-4 w-4 text-blue-300" />
                  <AlertDescription className="text-xs">
                    {(activeOp?.opType === "testing_stop" || (opInProgress && isEnabled)) ? "Stop Testing" : "Start Testing"} is in progress.{" "}
                    {isDeploying
                      ? "Range is actively processing — logs are streaming below."
                      : "Waiting for Ludus to begin processing. Logs will appear automatically."}
                  </AlertDescription>
                </Alert>
              )}
              {opStatusLabel === "completed" && (
                <Alert className="mt-4 border-green-500/30 bg-green-500/5">
                  <Activity className="h-4 w-4 text-green-400" />
                  <AlertDescription className="text-xs">
                    Operation completed successfully.
                  </AlertDescription>
                </Alert>
              )}
              {opStatusLabel === "error" && (
                <Alert className="mt-4" variant="destructive">
                  <AlertDescription className="text-xs">
                    Operation encountered an error. Check Range Logs for details.
                  </AlertDescription>
                </Alert>
              )}
              {!isInProgress && isEnabled && opStatusLabel !== "completed" && (
                <Alert variant="warning" className="mt-4">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    Testing mode is active. All VMs have been snapshotted and outbound internet
                    access is blocked except for explicitly allowed domains/IPs below.
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          {/* ── Log panel ── */}
          {showLogs && (
            <Card className="border-blue-500/20">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <ScrollText className={cn(
                      "h-4 w-4",
                      isStreaming ? "text-green-400 animate-pulse" : "text-muted-foreground"
                    )} />
                    Range Activity
                    {isStreaming && <Badge variant="success" className="text-xs">Live</Badge>}
                    {!isStreaming && opInProgress && (
                      <Badge variant="secondary" className="text-xs gap-1">
                        <Clock className="h-3 w-3" />Waiting
                      </Badge>
                    )}
                    {!isStreaming && !opInProgress && logLines.length > 0 && (
                      <Badge variant="secondary" className="text-xs">Done</Badge>
                    )}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    {!isStreaming && isDeploying && (
                      <Button size="sm" variant="outline" onClick={() => selectedRangeId && startLogStream(selectedRangeId)} className="gap-1.5 text-xs h-7">
                        <Activity className="h-3 w-3" />Reconnect
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setShowLogs(false)} className="text-xs h-7 text-muted-foreground">Hide</Button>
                    <Link href="/logs">
                      <Button size="sm" variant="ghost" className="text-xs h-7 text-primary">Full Logs →</Button>
                    </Link>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {(isInProgress || isStreaming || addingEntry || !!removingEntry) && logLines.length === 0 && (
                  <div className="flex flex-col gap-2 py-5 px-2">
                    <div className="flex items-center gap-2 text-sm text-blue-300">
                      <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
                      <span className="font-medium">
                        {addingEntry
                          ? "Applying allow rule…"
                          : removingEntry
                          ? "Removing allow rule…"
                          : (activeOp?.opType === "testing_stop" || (opInProgress && isEnabled))
                          ? "Stopping Testing Mode…"
                          : "Starting Testing Mode…"}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground ml-6">
                      {isStreaming
                        ? "Connected — waiting for Ludus to begin. Logs will appear here automatically."
                        : "Connecting to log stream…"}
                    </p>
                  </div>
                )}
                {logLines.length > 0 && (
                  <LogViewer
                    lines={logLines}
                    autoScroll={isStreaming}
                    maxHeight="320px"
                    onClear={isStreaming ? undefined : () => setLogLines([])}
                  />
                )}
              </CardContent>
            </Card>
          )}

          {/* Show logs button when panel hidden but op in progress */}
          {!showLogs && isInProgress && (
            <Button
              variant="outline"
              className="w-full border-dashed border-blue-500/40 text-blue-400 hover:bg-blue-500/5"
              onClick={() => {
                setShowLogs(true)
                if (!isStreaming && isDeploying && selectedRangeId) startLogStream(selectedRangeId)
              }}
            >
              <Activity className="h-4 w-4 animate-pulse" />
              Range operation in progress — show logs
            </Button>
          )}

          {/* ── Allowed Domains & IPs ── */}
          {/* Ludus uses a single "allowedDomains" list for both domains and bare IPs.
              Entries returned by the API look like "domain.com (1.2.3.4)" or "8.8.8.8". */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Globe className="h-4 w-4 text-blue-400" />
                Allowed Domains &amp; IPs
                {displayedAllowed.length > 0 && (
                  <Badge variant="secondary">{displayedAllowed.length}</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input
                  placeholder="example.com or 1.2.3.4  (no wildcards or CIDR)"
                  value={newEntry}
                  onChange={(e) => setNewEntry(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAllow()}
                  className="font-mono text-sm"
                  disabled={!isEnabled || isInProgress || !!removingEntry || hasPendingOps || !!pendingAction}
                />
                <Button
                  onClick={handleAllow}
                  disabled={!isEnabled || isInProgress || addingEntry || !!removingEntry || hasPendingOps || !newEntry.trim() || !!pendingAction}
                  size="sm"
                >
                  {addingEntry
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Plus className="h-4 w-4" />}
                  Allow
                </Button>
              </div>

              {hasPendingOps && (
                <div className="flex items-center gap-2 text-xs text-amber-400/90">
                  <Loader2 className="h-3 w-3 animate-spin flex-shrink-0" />
                  <span>
                    {pendingAdds.length > 0 && pendingRemoves.length > 0
                      ? "Adding and removing rules — checking for confirmation…"
                      : pendingAdds.length > 0
                        ? `Adding ${pendingAdds.join(", ")} — waiting for Ludus to confirm…`
                        : `Removing ${pendingRemoves.join(", ")} — waiting for Ludus to confirm…`}
                  </span>
                </div>
              )}

              {(!isEnabled || isInProgress) && !hasPendingOps && (
                <p className="text-xs text-muted-foreground">
                  {isInProgress
                    ? "Wait for the operation to complete before managing allow rules."
                    : "Enable testing mode to manage allowed domains and IPs."}
                </p>
              )}

              {isEnabled && !isInProgress && !hasPendingOps && (
                <p className="text-xs text-muted-foreground">
                  Enter a domain name (e.g. <code>example.com</code>) or an exact IP address (e.g.{" "}
                  <code>8.8.8.8</code>). Wildcards and CIDR ranges are not supported by Ludus.
                  Domain entries also allow the associated CRL certificate domains automatically.
                  Adding a domain may take 1-2 minutes while Ludus resolves its IP.
                </p>
              )}

              {displayedAllowed.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">No domains or IPs allowed</p>
              ) : (
                <div className="space-y-1">
                  {displayedAllowed.map((entry) => {
                    const parsed       = parseEntry(entry)
                    const isRemoving   = removingEntry === entry
                    const isPendingAdd = pendingAdds.includes(parsed.raw)
                    const isPendingRm  = pendingRemoves.includes(parsed.raw)
                    return (
                      <div
                        key={entry}
                        className={cn(
                          "flex items-center justify-between py-1.5 px-3 rounded-md border transition-opacity",
                          (isRemoving || isPendingRm)
                            ? "bg-muted/30 border-border/50 opacity-50"
                            : isPendingAdd
                              ? "bg-amber-950/30 border-amber-500/30"
                              : "bg-muted/50 border-border",
                        )}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {parsed.type === "ip"
                            ? <Network className="h-3 w-3 text-cyan-400 flex-shrink-0" />
                            : <Globe   className="h-3 w-3 text-blue-400  flex-shrink-0" />}
                          <code className="text-xs font-mono truncate">{parsed.display}</code>
                          {isPendingAdd && !isRemoving && (
                            <span className="flex items-center gap-1 text-xs text-amber-400/80 italic flex-shrink-0">
                              <Loader2 className="h-2.5 w-2.5 animate-spin" />
                              pending
                            </span>
                          )}
                          {(isRemoving || isPendingRm) && (
                            <span className="text-xs text-muted-foreground italic flex-shrink-0">removing…</span>
                          )}
                        </div>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => handleDenyEntry(entry)}
                          disabled={isInProgress || !!removingEntry || isPendingAdd || isPendingRm}
                        >
                          {(isRemoving || isPendingRm)
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <Trash2  className="h-3 w-3 text-red-400" />}
                        </Button>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
