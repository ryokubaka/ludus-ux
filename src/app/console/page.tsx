"use client"

import { Suspense, useEffect, useRef, useState, useCallback } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { ludusApi } from "@/lib/api"
import type { VMObject } from "@/lib/types"
import {
  Monitor,
  ChevronDown,
  LayoutDashboard,
  RefreshCw,
  Circle,
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

  const [vms, setVms] = useState<FlatVM[]>([])
  const [loading, setLoading] = useState(true)

  // Currently displayed VM
  const [activeVm, setActiveVm] = useState<FlatVM | null>(null)

  // Iframe src keyed by vmId — changing it reloads only that iframe
  const [iframeSrc, setIframeSrc] = useState<string>("")

  // Whether the VM picker dropdown is open
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  // Fetch VMs from all ranges
  const fetchVms = useCallback(async () => {
    setLoading(true)
    try {
      const res = await ludusApi.getRangeStatus()
      if (res.data) {
        const ranges = Array.isArray(res.data) ? res.data : [res.data]
        const flat: FlatVM[] = []
        for (const range of ranges) {
          const vmList = range.VMs || range.vms || []
          for (const vm of vmList) {
            flat.push({ ...vm, rangeID: range.rangeID || range.name || "range" })
          }
        }
        setVms(flat)

        // Pre-select VM from URL query param (e.g. ?vmId=145&vmName=DC01)
        const paramId = searchParams.get("vmId")
        const paramName = searchParams.get("vmName")
        if (paramId) {
          const found = flat.find((v) => String(v.proxmoxID) === paramId)
          const vm = found || ({
            proxmoxID: parseInt(paramId),
            name: paramName || `vm-${paramId}`,
            rangeID: "",
          } as FlatVM)
          activateVm(vm)
        }
      }
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    fetchVms()
  }, [fetchVms])

  // Close picker when clicking outside
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false)
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
            <div className="absolute left-0 top-full mt-1 w-72 bg-zinc-900 border border-zinc-700 rounded shadow-xl z-50 max-h-80 overflow-y-auto">
              {loading ? (
                <div className="px-4 py-3 text-xs text-zinc-500">Loading VMs…</div>
              ) : vms.length === 0 ? (
                <div className="px-4 py-3 text-xs text-zinc-500">No VMs found. Deploy a range first.</div>
              ) : (
                vms.map((vm) => (
                  <button
                    key={vm.proxmoxID}
                    onClick={() => activateVm(vm)}
                    className={`w-full flex items-center gap-2.5 px-4 py-2 text-left hover:bg-zinc-800 transition-colors ${
                      activeVm?.proxmoxID === vm.proxmoxID ? "bg-zinc-800/80" : ""
                    }`}
                  >
                    <Circle
                      className={`h-2 w-2 shrink-0 ${vm.poweredOn ? "fill-green-400 text-green-400" : "fill-zinc-600 text-zinc-600"}`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-zinc-200 truncate">{vm.name}</div>
                      <div className="text-[10px] text-zinc-500 truncate">
                        ID {vm.proxmoxID} · {vm.ip || "—"}
                      </div>
                    </div>
                    {activeVm?.proxmoxID === vm.proxmoxID && (
                      <span className="text-[10px] text-purple-400">active</span>
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
              <p className="text-sm text-zinc-500">
                No VM selected
              </p>
              <p className="text-xs text-zinc-600">
                Use the dropdown above to pick a VM and open its console.
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
