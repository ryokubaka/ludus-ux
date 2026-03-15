"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Separator } from "@/components/ui/separator"
import {
  ArrowLeft,
  ChevronRight,
  ChevronLeft,
  Check,
  Loader2,
  Plus,
  Trash2,
  Server,
  HardDrive,
  Cpu,
  MemoryStick,
  Network,
  Play,
  AlertTriangle,
  Settings2,
  Tag,
  Info,
} from "lucide-react"
import { ludusApi } from "@/lib/api"
import { useRange } from "@/lib/range-context"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import type { TemplateObject, RangeObject } from "@/lib/types"

const STEPS = ["Select Range", "Configure VMs", "Domain Setup", "Deploy Tags", "Review & Deploy"]

const ALL_TAGS = [
  "vm-deploy", "network", "dns-rewrites", "assign-ip", "windows", "dcs",
  "domain-join", "sysprep", "user-defined-roles", "custom-choco",
  "linux-packages", "additional-tools", "install-office", "install-visual-studio",
  "allow-share-access", "custom-groups", "share", "nexus",
]

const TAG_DESCRIPTIONS: Record<string, string> = {
  "vm-deploy": "Create all VMs defined in config",
  network: "Set up VLANs and firewall rules",
  "dns-rewrites": "Configure DNS rewrites",
  "assign-ip": "Set static IPs and hostnames",
  windows: "Configure Windows VMs (RDP, WinRM, etc.)",
  dcs: "Set up domain controllers",
  "domain-join": "Join Windows VMs to domain",
  sysprep: "Run sysprep on Windows VMs",
  "user-defined-roles": "Apply Ansible roles",
  "custom-choco": "Install chocolatey packages",
  "linux-packages": "Install Linux packages",
  "additional-tools": "Install Firefox, Chrome, Burp, etc.",
  "install-office": "Install Microsoft Office",
  "install-visual-studio": "Install Visual Studio",
  "allow-share-access": "Enable anonymous SMB share access",
  "custom-groups": "Set custom Ansible groups",
  share: "Deploy Ludus Share VM",
  nexus: "Deploy Nexus cache VM",
}

interface VMEntry {
  id: string
  template: string
  vmName: string
  hostname: string
  vlan: number
  ipLastOctet: number
  ramGb: number
  cpus: number
  isLinux: boolean
  isWindows: boolean
  isServer: boolean
  domainRole: "none" | "primary-dc" | "alt-dc" | "member"
  testingSnapshot: boolean
  testingBlockInternet: boolean
  showAdvanced: boolean
}

function inferOS(templateName: string): { isLinux: boolean; isWindows: boolean; isServer: boolean } {
  const lower = templateName.toLowerCase()
  const isWindows = lower.includes("win")
  const isLinux = !isWindows
  const isServer = isWindows && (lower.includes("server") || lower.includes("dc"))
  return { isLinux, isWindows, isServer }
}

function defaultsForTemplate(template: string): VMEntry {
  const { isLinux, isWindows, isServer } = inferOS(template)
  // hostname is the user-supplied suffix only (no {{ range_id }}- prefix).
  // The prefix is added by generateYaml and shown read-only in the UI.
  const shortName = template.replace(/-template$/, "").replace(/-x64|-x86/g, "")
  // For Windows produce a cleaner default that fits in 15 chars:
  //   win2022-server → win2022-srv   win2022-workstation → win2022-ws
  const windowsShort = isWindows
    ? shortName.replace(/-?workstation$/i, "-ws").replace(/-?server$/i, "-srv")
    : shortName
  const hostnameSuffix = windowsShort.slice(0, isWindows ? 15 : 50)
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    template,
    vmName: `{{ range_id }}-${hostnameSuffix}`,
    hostname: hostnameSuffix,
    vlan: 10,
    ipLastOctet: 10,
    ramGb: isServer ? 8 : isLinux ? 4 : 8,
    cpus: isServer ? 4 : 2,
    isLinux,
    isWindows,
    isServer,
    domainRole: "none",
    testingSnapshot: false,
    testingBlockInternet: false,
    showAdvanced: true,
  }
}


function generateYaml(vms: VMEntry[], domainFqdn: string | null): string {
  const lines: string[] = ["ludus:"]
  for (const vm of vms) {
    // vmName = "{{ range_id }}-<suffix>"; hostname in Ludus YAML uses the same pattern
    const vmName = vm.vmName || `{{ range_id }}-${vm.hostname}`
    const hostname = `{{ range_id }}-${vm.hostname}`
    lines.push(`  - vm_name: "${vmName}"`)
    lines.push(`    hostname: "${hostname}"`)
    lines.push(`    template: ${vm.template}`)
    lines.push(`    vlan: ${vm.vlan}`)
    lines.push(`    ip_last_octet: ${vm.ipLastOctet}`)
    lines.push(`    ram_gb: ${vm.ramGb}`)
    lines.push(`    cpus: ${vm.cpus}`)
    if (vm.isLinux) lines.push(`    linux: true`)
    if (vm.isWindows) {
      lines.push(`    windows:`)
      lines.push(`      sysprep: false`)
    }
    if (domainFqdn && vm.domainRole !== "none") {
      lines.push(`    domain:`)
      lines.push(`      fqdn: ${domainFqdn}`)
      lines.push(`      role: ${vm.domainRole}`)
    }
    lines.push(`    testing:`)
    lines.push(`      snapshot: ${vm.testingSnapshot}`)
    lines.push(`      block_internet: ${vm.testingBlockInternet}`)
    lines.push("")
  }
  return lines.join("\n")
}

/**
 * Parse a Ludus range-config YAML into VMEntry[] for editing.
 * Handles the common fields; anything it can't parse is silently skipped.
 */
function parseConfigYaml(yamlText: string): VMEntry[] {
  const entries: VMEntry[] = []
  const blocks = yamlText.split(/(?=^\s*- vm_name:)/m)
  for (const block of blocks) {
    const get = (key: string): string => {
      const m = block.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, "m"))
      return m ? m[1].trim().replace(/^["']|["']$/g, "") : ""
    }
    const vmName = get("vm_name")
    if (!vmName) continue
    const template = get("template")
    const { isLinux, isWindows, isServer } = inferOS(template || vmName)
    // Strip any "{{ range_id }}-" prefix from the hostname so the field only
    // holds the user-editable suffix (matching our split-field UX).
    const rawHostname = get("hostname") || vmName
    const hostnameSuffix = rawHostname.replace(/^\{\{\s*range_id\s*\}\}-/, "")
    entries.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      template: template || vmName,
      vmName,
      hostname: hostnameSuffix.slice(0, isWindows ? 10 : 50),
      vlan: parseInt(get("vlan")) || 10,
      ipLastOctet: parseInt(get("ip_last_octet")) || 10,
      ramGb: parseInt(get("ram_gb")) || 4,
      cpus: parseInt(get("cpus")) || 2,
      isLinux,
      isWindows,
      isServer,
      domainRole: (get("role") as VMEntry["domainRole"]) || "none",
      testingSnapshot: get("snapshot") === "true",
      testingBlockInternet: get("block_internet") === "true",
      showAdvanced: false,
    })
  }
  return entries
}

export default function NewRangePage() {
  const router = useRouter()
  const { toast } = useToast()
  const { ranges: accessibleRanges, selectedRangeId, refreshRanges, selectRange } = useRange()
  const [step, setStep] = useState(0)

  // Step 0: Range selection
  const [mode, setMode] = useState<"existing" | "new">("existing")
  const [rangeName, setRangeName] = useState("")
  const [rangeId, setRangeId] = useState("")
  const [rangeDesc, setRangeDesc] = useState("")
  const [creating, setCreating] = useState(false)
  const [rangeCreated, setRangeCreated] = useState(false)
  const [selectedExistingRange, setSelectedExistingRange] = useState(selectedRangeId || "")
  const [loadingExistingConfig, setLoadingExistingConfig] = useState(false)
  const [currentUserID, setCurrentUserID] = useState<string | null>(null)

  // All ranges (for deconfliction)
  const [allRanges, setAllRanges] = useState<RangeObject[]>([])

  // Step 1: Templates + VMs
  const [templates, setTemplates] = useState<TemplateObject[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(true)
  const [vms, setVms] = useState<VMEntry[]>([])
  // Single shared VLAN for all VMs in this range
  const [rangeVlan, setRangeVlan] = useState(10)

  // Step 2: Domain
  const [enableDomain, setEnableDomain] = useState(false)
  const [domainFqdn, setDomainFqdn] = useState("ludus.network")

  // Step 3: Deploy
  const [deploying, setDeploying] = useState(false)
  const [deployResult, setDeployResult] = useState<"success" | "error" | null>(null)
  const [deployStatus, setDeployStatus] = useState("")
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [showTagSelector, setShowTagSelector] = useState(false)
  const [deletingVMs, setDeletingVMs] = useState(false)

  // Auto-generate rangeId from name (must start with a letter)
  useEffect(() => {
    if (!rangeCreated) {
      const raw = rangeName.replace(/[^A-Za-z0-9]/g, "_").replace(/^[^A-Za-z]+/, "").slice(0, 20)
      setRangeId(raw)
    }
  }, [rangeName, rangeCreated])

  // Fetch templates, all ranges for deconfliction, and current user info on mount
  useEffect(() => {
    ludusApi.listTemplates().then((res) => {
      if (res.data) {
        const built = (Array.isArray(res.data) ? res.data : []).filter((t) => t.built)
        setTemplates(built)
      }
      setTemplatesLoading(false)
    })
    ludusApi.getRanges().then((res) => {
      if (res.data) setAllRanges(Array.isArray(res.data) ? res.data : [res.data])
    })
    fetch("/api/auth/session")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.username) setCurrentUserID(data.username)
      })
      .catch(() => {})
  }, [])

  // Compute VLANs in use across all OTHER ranges (for deconfliction)
  const usedVlans = useMemo(() => {
    const vlans = new Set<number>()
    for (const r of allRanges) {
      if (mode === "existing" && r.rangeID === selectedExistingRange) continue
      const rVms = r.VMs || r.vms || []
      for (const vm of rVms) {
        const ipParts = vm.ip?.split(".")
        if (ipParts?.length === 4) vlans.add(parseInt(ipParts[2]))
      }
    }
    return vlans
  }, [allRanges, mode, selectedExistingRange])

  // VMs already deployed in the selected existing range (for destroy warning + IP display)
  const existingRangeData = useMemo(() => {
    if (!selectedExistingRange) return null
    return allRanges.find((r) => r.rangeID === selectedExistingRange) ?? null
  }, [allRanges, selectedExistingRange])

  const existingDeployedVMs = useMemo(
    () => existingRangeData?.VMs || (existingRangeData as (RangeObject & { vms?: RangeObject["VMs"] }) | null)?.vms || [],
    [existingRangeData]
  )

  // VLANs (3rd IP octet) occupied by the already-deployed VMs in the selected existing range
  const existingDeployedVlans = useMemo(() => {
    const vlans = new Set<number>()
    for (const vm of existingDeployedVMs) {
      const parts = vm.ip?.split(".")
      if (parts?.length === 4) {
        const v = parseInt(parts[2])
        if (!isNaN(v)) vlans.add(v)
      }
    }
    return vlans
  }, [existingDeployedVMs])

  // True when the user is about to deploy into a VLAN that already has live VMs —
  // those VMs will be destroyed by the deployment.
  const willDestroyExistingVMs =
    mode === "existing" &&
    existingDeployedVMs.length > 0 &&
    existingDeployedVlans.has(rangeVlan)

  // Auto-initialize rangeVlan to next available VLAN (only for *new* ranges —
  // existing range configs seed the VLAN from their loaded YAML).
  useEffect(() => {
    if (mode !== "new" || usedVlans.size === 0 || vms.length > 0) return
    let v = 10
    while (usedVlans.has(v) && v < 250) v++
    setRangeVlan(v)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usedVlans, mode])

  // Compute the next available rangeNumber (10.x second octet)
  // Ludus assigns this server-side, but we can predict it for display purposes.
  const nextRangeNumber = useMemo(() => {
    const used = new Set(allRanges.map((r) => r.rangeNumber).filter((n) => typeof n === "number" && n > 0))
    let n = 1  // Ludus assigns second octets starting from 2 (10.1.*, 10.2.*, …)
    while (used.has(n) && n < 254) n++
    return n
  }, [allRanges])

  const usedRangeIds = useMemo(() => {
    return new Set(allRanges.map((r) => r.rangeID).filter(Boolean))
  }, [allRanges])

  // The second IP octet (range number) to show in the preview "10.<n>.<vlan>.<octet>".
  // For an existing range we know the real number; for a new range we predict it.
  const displayRangeNumber = useMemo((): number | string => {
    if (mode === "existing" && existingRangeData?.rangeNumber != null) {
      return existingRangeData.rangeNumber
    }
    if (mode === "new") return nextRangeNumber
    return "?"
  }, [mode, existingRangeData, nextRangeNumber])

  const effectiveRangeId = mode === "existing" ? selectedExistingRange : rangeId

  const addVM = useCallback((template: string) => {
    setVms((prev) => {
      const newVm = defaultsForTemplate(template)
      // All VMs share the same VLAN; ip_last_octet increments per VM
      const ipLastOctet = 10 + prev.length
      return [...prev, { ...newVm, vlan: rangeVlan, ipLastOctet }]
    })
  }, [rangeVlan])

  const removeVM = useCallback((id: string) => {
    setVms((prev) => {
      // Re-number ip_last_octet sequentially after removal
      const filtered = prev.filter((v) => v.id !== id)
      return filtered.map((v, i) => ({ ...v, ipLastOctet: 10 + i }))
    })
  }, [])

  // When the shared VLAN changes, update all VMs
  const handleRangeVlanChange = useCallback((vlan: number) => {
    setRangeVlan(vlan)
    setVms((prev) => prev.map((v) => ({ ...v, vlan })))
  }, [])

  const updateVM = useCallback((id: string, patch: Partial<VMEntry>) => {
    setVms((prev) => prev.map((v) => {
      if (v.id !== id) return v
      const updated = { ...v, ...patch }
      // Keep vmName in sync whenever the hostname suffix changes
      if ("hostname" in patch) {
        updated.vmName = `{{ range_id }}-${patch.hostname ?? ""}`
      }
      return updated
    }))
  }, [])

  // Step 0 → Step 1: When using existing range, load its config
  const handleUseExisting = async () => {
    if (!selectedExistingRange) return
    setLoadingExistingConfig(true)
    try {
      const res = await ludusApi.getRangeConfig(selectedExistingRange)
      const yamlText = typeof res.data === "string" ? res.data : res.data?.result || ""
      if (yamlText) {
        const parsed = parseConfigYaml(yamlText)
        if (parsed.length > 0) {
          setVms(parsed)
          // Seed shared VLAN from the first VM in the existing config
          if (parsed[0]?.vlan) setRangeVlan(parsed[0].vlan)
        }
      }
    } catch {}
    setLoadingExistingConfig(false)
    setStep(1)
  }

  const handleCreateRange = async () => {
    if (!rangeName || !rangeId) return
    if (usedRangeIds.has(rangeId)) {
      toast({ title: "Range ID conflict", description: `"${rangeId}" is already in use. Choose a different ID.`, variant: "destructive" })
      return
    }
    setCreating(true)
    try {
      const result = await ludusApi.createRange({
        name: rangeName,
        rangeID: rangeId,
        description: rangeDesc || undefined,
        userID: currentUserID ? [currentUserID] : undefined,
      })
      if (result.error) {
        toast({ title: "Failed to create range", description: result.error, variant: "destructive" })
        setCreating(false)
        return
      }
      // Explicitly assign the new range to the current user so it appears in their accessible list
      if (currentUserID) {
        await ludusApi.assignRange(currentUserID, rangeId).catch(() => {
          // Non-fatal — range exists, assignment is best-effort
        })
      }
      setRangeCreated(true)
      await refreshRanges()
      toast({ title: "Range created", description: `Range ${rangeId} created successfully` })
      setStep(1)
    } catch (err) {
      toast({ title: "Error", description: (err as Error).message, variant: "destructive" })
    }
    setCreating(false)
  }

  // Auto-assign domain roles when toggling domain
  useEffect(() => {
    if (!enableDomain) {
      setVms((prev) => prev.map((v) => ({ ...v, domainRole: "none" as const })))
      return
    }
    setVms((prev) => {
      let hasPrimaryDc = false
      return prev.map((v) => {
        if (!v.isWindows) return { ...v, domainRole: "none" as const }
        if (v.isServer && !hasPrimaryDc) {
          hasPrimaryDc = true
          return { ...v, domainRole: "primary-dc" as const }
        }
        if (v.isServer) return { ...v, domainRole: "alt-dc" as const }
        return { ...v, domainRole: "member" as const }
      })
    })
  }, [enableDomain])

  const yaml = useMemo(
    () => generateYaml(vms, enableDomain ? domainFqdn : null),
    [vms, enableDomain, domainFqdn]
  )

  const toggleTag = (tag: string) =>
    setSelectedTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag])

  const handleDeploy = async () => {
    setDeploying(true)
    setDeployResult(null)
    setDeployStatus("")
    try {
      // When redeploying to an existing range that has live VMs, destroy them first
      // so the new config starts from a clean slate.
      if (mode === "existing" && existingDeployedVMs.length > 0) {
        setDeletingVMs(true)
        setDeployStatus("Destroying existing VMs…")
        const delRes = await ludusApi.deleteRangeVMs(selectedExistingRange)
        if (delRes.error) {
          toast({ title: "VM deletion failed", description: delRes.error, variant: "destructive" })
          setDeploying(false)
          setDeletingVMs(false)
          setDeployStatus("")
          return
        }
        // Poll until the range reports 0 VMs (up to ~90 s)
        const maxWait = 90_000
        const poll = 4_000
        const start = Date.now()
        while (Date.now() - start < maxWait) {
          await new Promise((r) => setTimeout(r, poll))
          const check = await ludusApi.getRanges()
          const updated = (Array.isArray(check.data) ? check.data : [])
            .find((r: RangeObject) => r.rangeID === selectedExistingRange)
          const remaining = (updated?.VMs || (updated as (RangeObject & { vms?: RangeObject["VMs"] }) | undefined)?.vms || []).length
          if (remaining === 0) break
          setDeployStatus(`Waiting for ${remaining} VM${remaining !== 1 ? "s" : ""} to be destroyed…`)
        }
        setDeletingVMs(false)
        setDeployStatus("Uploading configuration…")
      }

      const configRes = await ludusApi.setRangeConfig(yaml, effectiveRangeId || undefined)
      if (configRes.error) {
        toast({ title: "Config upload failed", description: configRes.error, variant: "destructive" })
        setDeploying(false)
        setDeployStatus("")
        return
      }
      setDeployStatus("Starting deployment…")
      const deployRes = await ludusApi.deployRange(
        selectedTags.length > 0 ? selectedTags : undefined,
        undefined,
        effectiveRangeId || undefined,
      )
      if (deployRes.error) {
        toast({ title: "Deploy failed", description: deployRes.error, variant: "destructive" })
        setDeployResult("error")
        setDeploying(false)
        setDeployStatus("")
        return
      }
      // Select the target range and go straight to the dashboard for live status.
      await refreshRanges()
      if (effectiveRangeId) selectRange(effectiveRangeId)
      toast({ title: "Deployment started", description: `Range ${effectiveRangeId ?? "default"} is being provisioned.` })
      router.push("/")
    } catch (err) {
      toast({ title: "Error", description: (err as Error).message, variant: "destructive" })
      setDeployResult("error")
    }
    setDeploying(false)
    setDeployStatus("")
  }

  const rangeIdConflict = mode === "new" && !!rangeId && usedRangeIds.has(rangeId)

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" asChild>
          <Link href="/"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 className="text-lg font-semibold">Deploy New Range</h1>
          <p className="text-xs text-muted-foreground">Create a new Ludus range or modify an existing one</p>
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 flex-wrap">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={cn(
              "flex items-center justify-center h-7 w-7 rounded-full text-xs font-bold",
              i < step ? "bg-green-500/20 text-green-400 border border-green-500/40"
                : i === step ? "bg-primary/20 text-primary border border-primary/40"
                : "bg-muted text-muted-foreground border border-border"
            )}>
              {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </div>
            <span className={cn("text-sm", i === step ? "text-foreground font-medium" : "text-muted-foreground")}>{s}</span>
            {i < STEPS.length - 1 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </div>
        ))}
      </div>

      {/* ── Step 0: Select or Create Range ──────────────────────────────────── */}
      {step === 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Target Range</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Button variant={mode === "existing" ? "default" : "outline"} size="sm"
                onClick={() => setMode("existing")}>Use Existing Range</Button>
              <Button variant={mode === "new" ? "default" : "outline"} size="sm"
                onClick={() => setMode("new")}>
                Create New Range
              </Button>
            </div>

            <Separator />

            {mode === "existing" ? (
              <div className="space-y-3">
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription className="text-xs space-y-1">
                    <p>
                      Continuing through this wizard will <strong>destroy all existing VMs</strong> in the selected
                      range and redeploy from scratch.
                    </p>
                    <p>
                      To update configuration or run individual deployment steps <em>without</em> deleting VMs,
                      use the{" "}
                      <Link href="/range/config" className="underline text-primary font-medium">
                        Config &amp; Deploy
                      </Link>{" "}
                      page instead.
                    </p>
                  </AlertDescription>
                </Alert>
                <p className="text-xs text-muted-foreground">Select a range to rebuild:</p>
                {accessibleRanges.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No accessible ranges found. Create a new one instead.</p>
                ) : (
                  <div className="grid gap-2">
                    {accessibleRanges.map((r) => {
                      const rd = allRanges.find((x) => x.rangeID === r.rangeID)
                      const vmCount = (rd?.VMs || (rd as (RangeObject & { vms?: RangeObject["VMs"] }) | undefined)?.vms || []).length
                      const rn = rd?.rangeNumber
                      return (
                        <button key={r.rangeID} onClick={() => setSelectedExistingRange(r.rangeID)}
                          className={cn(
                            "text-left p-3 rounded-lg border-2 transition-all",
                            selectedExistingRange === r.rangeID
                              ? "border-primary bg-primary/10"
                              : "border-border hover:border-primary/50"
                          )}>
                          <div className="flex items-center justify-between">
                            <code className="font-mono font-bold text-primary text-sm">{r.rangeID}</code>
                            <div className="flex items-center gap-2">
                              {vmCount > 0 && (
                                <Badge variant="warning" className="text-[10px]">{vmCount} VMs</Badge>
                              )}
                              <Badge variant="secondary" className="text-[10px]">{r.accessType}</Badge>
                              {selectedExistingRange === r.rangeID && <Check className="h-4 w-4 text-primary" />}
                            </div>
                          </div>
                          {rn != null && (
                            <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                              10.{rn}.* network
                            </p>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
                <div className="flex justify-end">
                  <Button onClick={handleUseExisting} disabled={!selectedExistingRange || loadingExistingConfig}>
                    {loadingExistingConfig
                      ? <><Loader2 className="h-4 w-4 animate-spin" /> Loading config...</>
                      : <>Next <ChevronRight className="h-4 w-4" /></>}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="rangeName">Name</Label>
                    <Input id="rangeName" value={rangeName} onChange={(e) => setRangeName(e.target.value)}
                      placeholder="Red Team Range" disabled={rangeCreated} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rangeId">Range ID</Label>
                    <Input id="rangeId" value={rangeId}
                      onChange={(e) => setRangeId(e.target.value.replace(/[^A-Za-z0-9_-]/g, "").replace(/^[^A-Za-z]+/, ""))}
                      placeholder="RedTeam" disabled={rangeCreated}
                      className={cn("font-mono", rangeIdConflict && "border-red-500")} maxLength={20} />
                    {rangeIdConflict
                      ? <p className="text-[10px] text-red-400">This Range ID is already in use</p>
                      : <p className="text-[10px] text-muted-foreground">Must start with letter, letters/numbers/hyphens/underscores</p>}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rangeDesc">Description (optional)</Label>
                  <Input id="rangeDesc" value={rangeDesc} onChange={(e) => setRangeDesc(e.target.value)}
                    placeholder="Range for labs" disabled={rangeCreated} />
                </div>
                {!rangeCreated && allRanges.length > 0 && (
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <Network className="h-3 w-3" />
                    Ludus will automatically assign IP block{" "}
                    <code className="font-mono text-primary">10.{nextRangeNumber}.*</code>
                    {" "}(next available second octet on this server).
                  </p>
                )}
                <div className="flex justify-end">
                  {rangeCreated ? (
                    <Button onClick={() => setStep(1)}>
                      Next <ChevronRight className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button onClick={handleCreateRange} disabled={!rangeName || !rangeId || creating || rangeIdConflict}>
                      {creating ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating...</>
                        : <><Plus className="h-4 w-4" /> Create Range &amp; Continue</>}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Step 1: Select VMs ──────────────────────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Available Templates</CardTitle></CardHeader>
            <CardContent>
              {templatesLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : templates.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No built templates found</p>
              ) : (
                <div className="grid grid-cols-2 gap-2 max-h-80 overflow-y-auto">
                  {templates.map((t) => {
                    const { isLinux, isWindows } = inferOS(t.name)
                    return (
                      <button key={t.name} onClick={() => addVM(t.name)}
                        className="flex items-center gap-2 p-2 rounded border border-border hover:border-primary/50 hover:bg-primary/5 transition-colors text-left">
                        <Plus className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs font-mono truncate">{t.name}</p>
                          <Badge variant="secondary" className="text-[10px]">{isWindows ? "Windows" : isLinux ? "Linux" : "Other"}</Badge>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {vms.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <HardDrive className="h-4 w-4" /> VMs in Range
                    <Badge variant="secondary">{vms.length}</Badge>
                  </CardTitle>
                  {/* Shared VLAN selector — applies to all VMs */}
                  <div className="flex items-center gap-2">
                    <Network className="h-3.5 w-3.5 text-muted-foreground" />
                    <Label className="text-xs text-muted-foreground whitespace-nowrap">Range VLAN</Label>
                    <Input
                      type="number"
                      value={rangeVlan}
                      min={2}
                      max={255}
                      onChange={(e) => handleRangeVlanChange(parseInt(e.target.value) || 10)}
                      className="h-7 w-20 text-xs text-center font-mono"
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {vms.map((vm) => (
                  <div key={vm.id} className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Server className="h-4 w-4 text-primary" />
                      <code className="text-xs font-mono font-medium flex-1 truncate">{vm.template}</code>
                      <div className="flex gap-1 items-center text-xs text-muted-foreground">
                        <Cpu className="h-3 w-3" /> {vm.cpus}
                        <span className="mx-1">|</span>
                        <MemoryStick className="h-3 w-3" /> {vm.ramGb}GB
                        <span className="mx-1">|</span>
                        <span className="font-mono">10.{displayRangeNumber}.{vm.vlan}.{vm.ipLastOctet}</span>
                      </div>
                      <Button size="icon-sm" variant="ghost" onClick={() => updateVM(vm.id, { showAdvanced: !vm.showAdvanced })}>
                        <Settings2 className="h-3 w-3" />
                      </Button>
                      <Button size="icon-sm" variant="ghost" onClick={() => removeVM(vm.id)}>
                        <Trash2 className="h-3 w-3 text-red-400" />
                      </Button>
                    </div>
                    {vm.showAdvanced && (
                      <div className="pt-2 border-t space-y-2">
                        {/* Hostname suffix (editable) + VM Name preview (read-only) */}
                        <div className="grid grid-cols-3 gap-2">
                          <div className="col-span-2 space-y-2">
                            <div className="space-y-1">
                              <Label className="text-[10px]">
                                Hostname
                                {vm.isWindows && <span className="text-muted-foreground ml-1">(max 15 chars)</span>}
                              </Label>
                              <Input
                                value={vm.hostname}
                                onChange={(e) => updateVM(vm.id, {
                                  hostname: e.target.value.slice(0, vm.isWindows ? 15 : 63)
                                })}
                                maxLength={vm.isWindows ? 15 : 63}
                                className="h-7 text-xs font-mono"
                                placeholder="server-01"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[10px] text-muted-foreground">VM Name (Proxmox)</Label>
                              <Input
                                value={vm.vmName}
                                readOnly
                                className="h-7 text-xs font-mono bg-muted/30 text-muted-foreground cursor-default"
                                tabIndex={-1}
                              />
                            </div>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[10px]">IP Last Octet</Label>
                            <Input type="number" value={vm.ipLastOctet} min={1} max={254}
                              onChange={(e) => updateVM(vm.id, { ipLastOctet: parseInt(e.target.value) || 10 })} className="h-7 text-xs" />
                          </div>
                        </div>
                        {/* Resources */}
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <Label className="text-[10px]">CPUs</Label>
                            <Input type="number" value={vm.cpus} min={1} max={32}
                              onChange={(e) => updateVM(vm.id, { cpus: parseInt(e.target.value) || 2 })} className="h-7 text-xs" />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[10px]">RAM (GB)</Label>
                            <Input type="number" value={vm.ramGb} min={1} max={128}
                              onChange={(e) => updateVM(vm.id, { ramGb: parseInt(e.target.value) || 4 })} className="h-7 text-xs" />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(0)}><ChevronLeft className="h-4 w-4" /> Back</Button>
            <Button onClick={() => setStep(2)} disabled={vms.length === 0}>Next <ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      )}

      {/* ── Step 2: Domain Configuration ────────────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Active Directory Domain</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <Checkbox id="enableDomain" checked={enableDomain}
                  onCheckedChange={(c) => setEnableDomain(!!c)} />
                <Label htmlFor="enableDomain" className="text-sm">Create an Active Directory domain</Label>
              </div>
              {enableDomain && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="domainFqdn">Domain FQDN</Label>
                    <Input id="domainFqdn" value={domainFqdn} onChange={(e) => setDomainFqdn(e.target.value)}
                      placeholder="ludus.network" className="font-mono" />
                  </div>
                  <Separator />
                  <p className="text-xs text-muted-foreground">Domain role assignments (auto-detected from template type):</p>
                  <div className="space-y-1">
                    {vms.map((vm) => (
                      <div key={vm.id} className="flex items-center gap-3 text-xs">
                        <code className="font-mono truncate flex-1">{vm.template}</code>
                        <select value={vm.domainRole}
                          onChange={(e) => updateVM(vm.id, { domainRole: e.target.value as VMEntry["domainRole"] })}
                          className="bg-muted border border-border rounded px-2 py-1 text-xs">
                          <option value="none">No domain</option>
                          <option value="primary-dc">Primary DC</option>
                          <option value="alt-dc">Alternate DC</option>
                          <option value="member">Domain member</option>
                        </select>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(1)}><ChevronLeft className="h-4 w-4" /> Back</Button>
            <Button onClick={() => setStep(3)}>Next <ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      )}

      {/* ── Step 3: Deploy Tags ──────────────────────────────────────────────── */}
      {step === 3 && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Tag className="h-4 w-4" />
                Deploy Tags
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Optionally limit the deployment to specific Ansible steps. Leave all unchecked for a full
                deployment (recommended for first-time deploys).
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-1.5 max-h-[26rem] overflow-y-auto pr-1">
                {ALL_TAGS.map((tag) => (
                  <button
                    key={tag}
                    className={cn(
                      "flex items-center gap-2 p-2 rounded border text-left transition-colors",
                      selectedTags.includes(tag)
                        ? "border-primary bg-primary/10"
                        : "border-border hover:border-primary/50"
                    )}
                    onClick={() => toggleTag(tag)}
                  >
                    <Checkbox
                      checked={selectedTags.includes(tag)}
                      onCheckedChange={() => toggleTag(tag)}
                      className="shrink-0"
                    />
                    <div className="min-w-0">
                      <code className="text-xs font-mono text-primary">{tag}</code>
                      <p className="text-[10px] text-muted-foreground truncate">{TAG_DESCRIPTIONS[tag] || ""}</p>
                    </div>
                  </button>
                ))}
              </div>
              {selectedTags.length > 0 && (
                <div className="flex items-center justify-between pt-1 border-t">
                  <p className="text-xs text-muted-foreground">
                    {selectedTags.length} tag{selectedTags.length !== 1 ? "s" : ""} selected — only these steps will run
                  </p>
                  <Button size="sm" variant="ghost" onClick={() => setSelectedTags([])}>
                    Clear all
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(2)}><ChevronLeft className="h-4 w-4" /> Back</Button>
            <Button onClick={() => setStep(4)}>Next <ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      )}

      {/* ── Step 4: Review & Deploy ──────────────────────────────────────────── */}
      {step === 4 && (
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Deployment Summary</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-xs text-muted-foreground">Range</span>
                  <p className="font-mono font-bold text-primary">{effectiveRangeId || "(default)"}</p>
                </div>
                {rangeName && (
                  <div>
                    <span className="text-xs text-muted-foreground">Name</span>
                    <p>{rangeName}</p>
                  </div>
                )}
                <div>
                  <span className="text-xs text-muted-foreground">VMs</span>
                  <p>{vms.length}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Domain</span>
                  <p>{enableDomain ? domainFqdn : "None"}</p>
                </div>
                {selectedTags.length > 0 && (
                  <div className="col-span-2">
                    <span className="text-xs text-muted-foreground">Tags</span>
                    <p className="flex flex-wrap gap-1 mt-0.5">
                      {selectedTags.map((t) => (
                        <code key={t} className="font-mono text-[11px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">{t}</code>
                      ))}
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Generated Configuration</CardTitle>
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/range/config">Edit in Full Editor</Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <pre className="bg-gray-950 border border-gray-700 rounded-lg p-4 font-mono text-xs text-gray-300 overflow-auto max-h-80 whitespace-pre">
                {yaml}
              </pre>
            </CardContent>
          </Card>

          {mode === "existing" && existingDeployedVMs.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-xs space-y-1">
                <p>
                  <strong>Range {selectedExistingRange} has {existingDeployedVMs.length} deployed VM{existingDeployedVMs.length !== 1 ? "s" : ""}.</strong>
                </p>
                <p>
                  Deploying will <strong>destroy all existing VMs</strong> in this range before provisioning
                  the new configuration. This cannot be undone.
                </p>
              </AlertDescription>
            </Alert>
          )}

          <Alert variant="warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              This will upload the configuration and start deploying {vms.length} VMs to range{" "}
              <strong>{effectiveRangeId || "default"}</strong>. Deployment may take 15–60+ minutes depending on VM count and templates.
            </AlertDescription>
          </Alert>

          <div className="flex justify-between items-center">
            <Button variant="ghost" onClick={() => setStep(3)} disabled={deploying}>
              <ChevronLeft className="h-4 w-4" /> Back
            </Button>
            <div className="flex items-center gap-3">
              {deployStatus && (
                <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {deployStatus}
                </span>
              )}
              <Button onClick={handleDeploy} disabled={deploying} className="min-w-36">
                {deploying
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> {deletingVMs ? "Destroying VMs…" : "Deploying…"}</>
                  : deployResult === "success" ? <><Check className="h-4 w-4" /> Deployed</>
                  : <><Play className="h-4 w-4" /> Deploy Range</>}
              </Button>
            </div>
          </div>

          {deployResult === "error" && (
            <Alert variant="destructive">
              <AlertDescription>Deployment failed. Check the error above and try again.</AlertDescription>
            </Alert>
          )}
        </div>
      )}
    </div>
  )
}
