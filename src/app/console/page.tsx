"use client"

import { Suspense, useEffect, useRef, useState, useCallback, useMemo } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { ludusApi } from "@/lib/api"
import { useRange } from "@/lib/range-context"
import type { VMObject } from "@/lib/types"
import {
  Monitor,
  ChevronDown,
  LayoutDashboard,
  RefreshCw,
  Circle,
  Layers,
  Download,
  ExternalLink,
} from "lucide-react"

interface FlatVM extends VMObject {
  rangeID: string
}

export default function ConsolePage() {
  return (
    <Suspense fallback={null}>
      <ConsolePageInner />
    </Suspense>
  )
}

function ConsolePageInner() {
  const searchParams = useSearchParams()
  const { ranges: accessibleRanges, selectedRangeId, selectRange } = useRange()

  // All VMs keyed by rangeID — fetched once per range on selection
  const [allVms, setAllVms] = useState<FlatVM[]>([])
  const [loading, setLoading] = useState(false)

  // Range picker dropdown
  const [rangePickerOpen, setRangePickerOpen] = useState(false)
  const rangePickerRef = useRef<HTMLDivElement>(null)

  // Currently displayed VM
  const [activeVm, setActiveVm] = useState<FlatVM | null>(null)

  // Iframe src — changing it reloads the iframe
  const [iframeSrc, setIframeSrc] = useState<string>("")

  // Whether the VM picker dropdown is open
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  // .vv download state
  const [downloadingVv, setDownloadingVv] = useState(false)

  // VMs visible in the picker — filtered to the selected range, deduplicated by proxmoxID
  const vms = useMemo<FlatVM[]>(() => {
    const list = selectedRangeId ? allVms.filter((v) => v.rangeID === selectedRangeId) : allVms
    const seen = new Set<number | string>()
    return list.filter((v) => {
      const key = v.proxmoxID ?? v.ID
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [allVms, selectedRangeId])

  // Fetch VMs for the currently selected range (or all ranges if none selected)
  const fetchVms = useCallback(async (rangeId?: string) => {
    setLoading(true)
    try {
      const res = await ludusApi.getRangeStatus(rangeId)
      if (res.data) {
        const ranges = Array.isArray(res.data) ? res.data : [res.data]
        const flat: FlatVM[] = []
        for (const range of ranges) {
          const vmList = range.VMs || range.vms || []
          for (const vm of vmList) {
            flat.push({ ...vm, rangeID: range.rangeID || range.name || "range" })
          }
        }
        // Merge into allVms (replace entries for this range).
        // Use the same fallback key that was stamped onto each FlatVM so the
        // filter correctly removes stale entries before inserting fresh ones.
        setAllVms((prev) => {
          const freshKeys = new Set(ranges.map((r) => r.rangeID || r.name || "range"))
          const other = prev.filter((v) => !freshKeys.has(v.rangeID))
          return [...other, ...flat]
        })

        // Pre-select VM from URL query param
        const paramId = searchParams.get("vmId")
        const paramName = searchParams.get("vmName")
        if (paramId && !activeVm) {
          const found = flat.find((v) => String(v.proxmoxID) === paramId)
          const vm = found || ({
            proxmoxID: parseInt(paramId),
            name: paramName || `vm-${paramId}`,
            rangeID: rangeId || "",
          } as FlatVM)
          activateVm(vm)
        }
      }
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  // Fetch VMs whenever the selected range changes.
  // Skip the fetch until we have a real rangeId — avoids a noisy "fetch all"
  // call while the range context is still hydrating from sessionStorage.
  useEffect(() => {
    if (!selectedRangeId) return
    fetchVms(selectedRangeId)
  }, [fetchVms, selectedRangeId])

  // Close VM picker when clicking outside
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false)
      }
      if (rangePickerRef.current && !rangePickerRef.current.contains(e.target as Node)) {
        setRangePickerOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  function activateVm(vm: FlatVM) {
    setActiveVm(vm)
    const vmid = String(vm.proxmoxID)
    const name = encodeURIComponent(vm.name)
    setIframeSrc(`/novnc-console.html?vmId=${vmid}&vmName=${name}`)
    setPickerOpen(false)
  }

  async function downloadVv() {
    if (!activeVm) return
    const vmid = String(activeVm.proxmoxID)
    const name = encodeURIComponent(activeVm.name)
    setDownloadingVv(true)
    try {
      const res = await fetch(`/api/console/spice?vmId=${vmid}&vmName=${name}`)
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string }
        console.error("SPICE download failed:", d.error || `HTTP ${res.status}`)
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${activeVm.name.replace(/[^a-zA-Z0-9._-]/g, "_")}.vv`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } finally {
      setDownloadingVv(false)
    }
  }

  function reloadConsole() {
    if (!activeVm) return
    // Force reload by briefly clearing then restoring src
    setIframeSrc("")
    setTimeout(() => {
      const vmid = String(activeVm.proxmoxID)
      const name = encodeURIComponent(activeVm.name)
      setIframeSrc(`/novnc-console.html?vmId=${vmid}&vmName=${name}`)
    }, 50)
  }

  return (
    <div className="flex flex-col bg-black" style={{ height: "100vh", overflow: "hidden" }}>
      {/* ── Top toolbar ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-2 bg-zinc-900 border-b border-zinc-800 shrink-0 h-11">
        {/* Back to dashboard */}
        <Link
          href="/"
          className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors mr-2"
        >
          <LayoutDashboard className="h-3.5 w-3.5" />
          <span>Dashboard</span>
        </Link>

        <div className="h-4 w-px bg-zinc-700" />

        <Monitor className="h-3.5 w-3.5 text-purple-400 shrink-0" />
        <span className="text-xs text-zinc-400 shrink-0">Console</span>

        {/* Range picker — always rendered so the active range is always visible */}
        <div ref={rangePickerRef} className="relative ml-2">
          <button
            onClick={() => setRangePickerOpen((o) => !o)}
            disabled={accessibleRanges.length === 0}
            className="flex items-center gap-2 px-3 py-1 rounded border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-default text-xs text-zinc-200 transition-colors"
          >
            <Layers className="h-3 w-3 text-purple-400 shrink-0" />
            <span className="max-w-[160px] truncate">
              {selectedRangeId ?? (accessibleRanges.length === 0 ? "Loading…" : "Select range…")}
            </span>
            <ChevronDown className="h-3 w-3 text-zinc-400 ml-1" />
          </button>
          {rangePickerOpen && accessibleRanges.length > 0 && (
            <div className="absolute left-0 top-full mt-1 min-w-full w-max max-w-[32rem] bg-zinc-900 border border-zinc-700 rounded shadow-xl z-50 max-h-64 overflow-y-auto">
              {accessibleRanges.map((r) => (
                <button
                  key={r.rangeID}
                  onClick={() => { selectRange(r.rangeID); setRangePickerOpen(false) }}
                  className={`w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-zinc-800 transition-colors text-xs ${
                    selectedRangeId === r.rangeID ? "text-purple-400 bg-zinc-800/80" : "text-zinc-200"
                  }`}
                >
                  <span className="font-mono whitespace-nowrap">{r.rangeID}</span>
                  {selectedRangeId === r.rangeID && <span className="ml-4 text-[10px] text-purple-400 shrink-0">active</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* VM picker */}
        <div ref={pickerRef} className="relative ml-2">
          <button
            onClick={() => setPickerOpen((o) => !o)}
            className="flex items-center gap-2 px-3 py-1 rounded border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 transition-colors"
          >
            {activeVm ? (
              <>
                <Circle
                  className={`h-2 w-2 shrink-0 ${activeVm.poweredOn ? "fill-green-400 text-green-400" : "fill-zinc-500 text-zinc-500"}`}
                />
                <span className="max-w-[220px] truncate">{activeVm.name}</span>
              </>
            ) : (
              <span className="text-zinc-500">Select a VM…</span>
            )}
            <ChevronDown className="h-3 w-3 text-zinc-400 ml-1" />
          </button>

          {pickerOpen && (
            <div className="absolute left-0 top-full mt-1 min-w-full w-max max-w-[min(90vw,_48rem)] bg-zinc-900 border border-zinc-700 rounded shadow-xl z-50 max-h-80 overflow-y-auto">
              {loading ? (
                <div className="px-4 py-3 text-xs text-zinc-500 whitespace-nowrap">Loading VMs…</div>
              ) : !selectedRangeId ? (
                <div className="px-4 py-3 text-xs text-zinc-500 whitespace-nowrap">Select a range first using the range picker.</div>
              ) : vms.length === 0 ? (
                <div className="px-4 py-3 text-xs text-zinc-500 whitespace-nowrap">No VMs in <span className="font-mono text-zinc-400">{selectedRangeId}</span>. Deploy first.</div>
              ) : (
                vms.map((vm) => (
                  <button
                    key={`${vm.rangeID}-${vm.proxmoxID}`}
                    onClick={() => activateVm(vm)}
                    className={`w-full flex items-center gap-2.5 px-4 py-2 text-left hover:bg-zinc-800 transition-colors ${
                      activeVm?.proxmoxID === vm.proxmoxID ? "bg-zinc-800/80" : ""
                    }`}
                  >
                    <Circle
                      className={`h-2 w-2 shrink-0 ${vm.poweredOn ? "fill-green-400 text-green-400" : "fill-zinc-600 text-zinc-600"}`}
                    />
                    <div className="flex-1">
                      <div className="text-xs text-zinc-200 whitespace-nowrap">{vm.name}</div>
                      <div className="text-[10px] text-zinc-500 whitespace-nowrap">
                        {vm.rangeID} · ID {vm.proxmoxID} · {vm.ip || "—"}
                      </div>
                    </div>
                    {activeVm?.proxmoxID === vm.proxmoxID && (
                      <span className="ml-4 text-[10px] text-purple-400 shrink-0">active</span>
                    )}
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Reconnect button */}
        {activeVm && (
          <button
            onClick={reloadConsole}
            title="Reconnect console"
            className="ml-1 p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        )}

        {/* Download .vv + virt-viewer hint */}
        {activeVm && (
          <>
            <div className="h-4 w-px bg-zinc-700 mx-1" />
            <button
              onClick={downloadVv}
              disabled={downloadingVv}
              title="Download SPICE .vv file — open with virt-viewer for a native console"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-300 hover:text-zinc-100 disabled:opacity-50 transition-colors"
            >
              <Download className="h-3 w-3" />
              {downloadingVv ? "…" : ".vv"}
            </button>
            <a
              href="https://virt-manager.org/download.html"
              target="_blank"
              rel="noopener noreferrer"
              title="Download virt-viewer to open .vv files natively"
              className="flex items-center gap-1 text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors whitespace-nowrap"
            >
              <ExternalLink className="h-2.5 w-2.5" />
              virt-viewer
            </a>
          </>
        )}

        <div className="flex-1" />

        {/* Hint when no VM selected */}
        {!activeVm && !loading && (
          <span className="text-xs text-zinc-600 italic">
            Select a VM from the dropdown to open its console
          </span>
        )}
      </div>

      {/* ── Console iframe ────────────────────────────────────────────────── */}
      <div className="flex-1 relative min-h-0">
        {!activeVm ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center space-y-3">
              <Monitor className="h-12 w-12 text-zinc-700 mx-auto" />
              <p className="text-sm text-zinc-500">No VM selected</p>
              <p className="text-xs text-zinc-600">
                Use the dropdown above to pick a VM and open its browser console.
              </p>
              <p className="text-xs text-zinc-700">
                For a native desktop experience, download the{" "}
                <span className="text-zinc-500">.vv</span> file and open it with{" "}
                <a
                  href="https://virt-manager.org/download/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-zinc-500 hover:text-zinc-300 underline underline-offset-2 transition-colors"
                >
                  virt-viewer
                </a>
                .
              </p>
            </div>
          </div>
        ) : iframeSrc ? (
          <iframe
            key={iframeSrc}
            src={iframeSrc}
            className="w-full h-full border-0 block"
            style={{ height: "100%", minHeight: 0 }}
            title={`Console: ${activeVm.name}`}
          />
        ) : null}
      </div>
    </div>
  )
}
