"use client"

import { useState, useMemo, useLayoutEffect } from "react"
import { useQuery, useQueries, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { STALE } from "@/lib/query-client"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Package,
  Plus,
  Trash2,
  RefreshCw,
  Play,
  Share2,
  Eye,
  Loader2,
  Copy,
  Crown,
  Users,
  FileCode,
} from "lucide-react"
import { ludusApi } from "@/lib/api"
import type {
  BlueprintListItem,
  BlueprintAccessUserItem,
  BlueprintAccessGroupItem,
  UserObject,
  GroupObject,
  RangeAccessEntry,
  RangeObject,
} from "@/lib/types"
import { useToast } from "@/hooks/use-toast"
import { cn, formatDate } from "@/lib/utils"
import { useRange } from "@/lib/range-context"

/** Ludus sometimes returns `{ result: [...] }`, a single row, or a bare array. */
function asObjectArray<T>(data: unknown): T[] {
  if (data == null) return []
  if (Array.isArray(data)) return data as T[]
  if (typeof data === "object" && "result" in data) {
    const inner = (data as { result: unknown }).result
    if (Array.isArray(inner)) return inner as T[]
    if (inner && typeof inner === "object") return [inner as T]
    return []
  }
  if (typeof data === "object") return [data as T]
  return []
}

function formatBlueprintAccessLabel(access?: string | string[]): string {
  if (access == null || access === "") return ""
  return Array.isArray(access) ? access.join(", ") : access
}

function bulkBlueprintErrors(data: unknown): { item: string; reason: string }[] {
  if (!data || typeof data !== "object") return []
  const errors = (data as { errors?: unknown }).errors
  if (!Array.isArray(errors)) return []
  return errors.filter(
    (e): e is { item: string; reason: string } =>
      !!e &&
      typeof e === "object" &&
      typeof (e as { item?: string }).item === "string" &&
      typeof (e as { reason?: string }).reason === "string"
  )
}

type BlueprintListGate = {
  isAdmin: boolean
  sessionUsername: string | null
  ludusUserId: string | null
}

function normalizeBlueprintAccessTokens(access: string | undefined): string[] {
  if (access == null) return []
  const raw = String(access).trim()
  if (!raw) return []
  const lowered = raw.toLowerCase()
  const segments = lowered.split(/[/|,]+/).map((s) => s.trim()).filter(Boolean)
  return (segments.length > 0 ? segments : [lowered]).map((b) => b.replace(/\s+/g, "_").replace(/-/g, "_"))
}

/** Non-admins: hide rows Ludus marks as no access; keep owner, known grants, and empty access (group shares often omit it). */
const BLUEPRINT_ACCESS_GRANT = new Set([
  "owner",
  "admin",
  "direct",
  "group",
  "shared",
  "read",
  "read-only",
  "readonly",
  "view",
  "viewer",
  "member",
  "user",
  "inherit",
  "inherited",
])

const BLUEPRINT_ACCESS_DENY = new Set(["none", "revoked", "denied", "no_access", "noaccess"])

function blueprintAccessIndicatesGrant(access: string | undefined): boolean {
  for (const t of normalizeBlueprintAccessTokens(access)) {
    if (BLUEPRINT_ACCESS_GRANT.has(t)) return true
  }
  return false
}

function blueprintAccessIndicatesDeny(access: string | undefined): boolean {
  for (const t of normalizeBlueprintAccessTokens(access)) {
    if (BLUEPRINT_ACCESS_DENY.has(t)) return true
  }
  return false
}

function viewerMayUseBlueprint(bp: BlueprintListItem, gate: BlueprintListGate): boolean {
  if (gate.isAdmin) return true
  const uid = (gate.ludusUserId || "").toLowerCase().trim()
  const sun = (gate.sessionUsername || "").toLowerCase().trim()
  const owner = (bp.ownerID || "").toLowerCase().trim()
  if (owner && (owner === uid || owner === sun)) return true
  if (blueprintAccessIndicatesDeny(bp.access)) return false
  if (blueprintAccessIndicatesGrant(bp.access)) return true
  // Ludus often leaves `access` empty for group-based visibility; if the row is returned, treat as visible.
  const accRaw = bp.access == null ? "" : String(bp.access).trim()
  if (!accRaw) return true
  return false
}

export default function BlueprintsPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { selectedRangeId, ranges: accessibleRanges, refreshRanges, selectRange } = useRange()
  const [createDialog, setCreateDialog] = useState(false)
  const [viewDialog, setViewDialog] = useState<{ id: string; yaml: string } | null>(null)
  const [shareDialog, setShareDialog] = useState<string | null>(null)
  const [shareUserSearch, setShareUserSearch] = useState("")
  const [shareGroupSearch, setShareGroupSearch] = useState("")
  const [selectedShareUsers, setSelectedShareUsers] = useState<Set<string>>(() => new Set())
  const [selectedShareGroups, setSelectedShareGroups] = useState<Set<string>>(() => new Set())
  const [sharing, setSharing] = useState(false)
  const [unsharingUserId, setUnsharingUserId] = useState<string | null>(null)
  const [unsharingGroupName, setUnsharingGroupName] = useState<string | null>(null)
  const [applyDialogBpId, setApplyDialogBpId] = useState<string | null>(null)
  const [applySubmitting, setApplySubmitting] = useState<"current" | "new" | null>(null)
  const [newRangeName, setNewRangeName] = useState("")
  const [newRangeId, setNewRangeId] = useState("")
  const [newBpId, setNewBpId] = useState("")
  const [newBpName, setNewBpName] = useState("")
  const [newBpDesc, setNewBpDesc] = useState("")
  const [createTab, setCreateTab] = useState<"from-range" | "yaml">("from-range")
  const [createSourceRangeId, setCreateSourceRangeId] = useState("")
  const [createYaml, setCreateYaml] = useState("")
  const [creating, setCreating] = useState(false)

  const {
    data: blueprints = [],
    isLoading: loading,
    isFetching: blueprintsFetching,
    refetch: refetchBlueprints,
  } = useQuery({
    queryKey: queryKeys.blueprints(),
    queryFn: async () => {
      const result = await ludusApi.listBlueprints()
      return asObjectArray<BlueprintListItem>(result.data)
    },
    staleTime: STALE.acl,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  })

  const { data: blueprintGate, isSuccess: blueprintGateReady } = useQuery({
    queryKey: ["auth", "blueprint-list-gate"],
    queryFn: async (): Promise<BlueprintListGate> => {
      const sRes = await fetch("/api/auth/session")
      const session = sRes.ok ? ((await sRes.json()) as { isAdmin?: boolean; username?: string }) : null
      const wRes = await ludusApi.whoami()
      const wData = wRes.data
      const who = Array.isArray(wData) ? wData[0] : wData
      const ludusUserId =
        who && typeof who === "object" && who !== null && "userID" in who
          ? String((who as UserObject).userID)
          : null
      return {
        isAdmin: session?.isAdmin === true,
        sessionUsername: session?.username ? String(session.username) : null,
        ludusUserId,
      }
    },
    staleTime: STALE.medium,
  })

  const visibleBlueprints = useMemo(() => {
    if (!blueprintGateReady || !blueprintGate) return []
    return blueprints.filter((bp) => viewerMayUseBlueprint(bp, blueprintGate))
  }, [blueprints, blueprintGate, blueprintGateReady])

  const listReady = !loading && blueprintGateReady

  const sharingQueries = useQueries({
    queries: visibleBlueprints.map((bp) => {
      const id = bp.id || bp.blueprintID || ""
      return {
        queryKey: queryKeys.blueprintSharing(id),
        queryFn: async () => {
          const [u, g] = await Promise.all([
            ludusApi.getBlueprintAccessUsers(id),
            ludusApi.getBlueprintAccessGroups(id),
          ])
          return {
            users: asObjectArray<BlueprintAccessUserItem>(u.data),
            groups: asObjectArray<BlueprintAccessGroupItem>(g.data),
          }
        },
        enabled: !!id && listReady,
        staleTime: STALE.medium,
      }
    }),
  })

  const invalidateBlueprints = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.blueprints(), exact: false })
  }

  const refreshBlueprints = () => {
    invalidateBlueprints()
    void refetchBlueprints()
  }

  const { data: ownedRanges = [], isLoading: loadingOwnedRanges } = useQuery({
    queryKey: queryKeys.rangesOwned(),
    queryFn: async () => {
      const r = await ludusApi.getRangesForUser()
      return r.data ?? []
    },
    enabled: createDialog,
    staleTime: STALE.short,
  })

  useLayoutEffect(() => {
    if (!createDialog || ownedRanges.length === 0) return
    setCreateSourceRangeId((prev: string) => {
      const ids = ownedRanges.map((r: RangeObject) => r.rangeID)
      if (prev && ids.includes(prev)) return prev
      if (selectedRangeId && ids.includes(selectedRangeId)) return selectedRangeId
      return ids[0] ?? ""
    })
  }, [createDialog, ownedRanges, selectedRangeId])

  const { data: sharePickerUsers = [], isLoading: loadingShareUsers } = useQuery({
    queryKey: queryKeys.users(),
    queryFn: async () => {
      const r = await ludusApi.listAllUsers().catch(() => ludusApi.listUsers())
      return asObjectArray<UserObject>(r.data)
    },
    enabled: !!shareDialog,
    staleTime: STALE.medium,
  })

  const { data: sharePickerGroups = [], isLoading: loadingShareGroups } = useQuery({
    queryKey: queryKeys.groups(),
    queryFn: async () => {
      const r = await ludusApi.listGroups()
      const raw = r.data as unknown
      if (raw && typeof raw === "object" && "groups" in raw && Array.isArray((raw as { groups: unknown }).groups)) {
        return asObjectArray<GroupObject>((raw as { groups: unknown }).groups)
      }
      return asObjectArray<GroupObject>(raw)
    },
    enabled: !!shareDialog,
    staleTime: STALE.medium,
  })

  const { data: shareDialogAccess, isLoading: loadingShareDialogAccess } = useQuery({
    queryKey: queryKeys.blueprintSharing(shareDialog || "_"),
    queryFn: async () => {
      const [u, g] = await Promise.all([
        ludusApi.getBlueprintAccessUsers(shareDialog!),
        ludusApi.getBlueprintAccessGroups(shareDialog!),
      ])
      return {
        users: asObjectArray<BlueprintAccessUserItem>(u.data),
        groups: asObjectArray<BlueprintAccessGroupItem>(g.data),
      }
    },
    enabled: !!shareDialog,
    staleTime: STALE.short,
  })

  const filteredShareUsers = useMemo(() => {
    const q = shareUserSearch.trim().toLowerCase()
    const list = Array.isArray(sharePickerUsers) ? sharePickerUsers : []
    return (list as UserObject[])
      .filter((u) => {
        if (!q) return true
        return (
          u.userID.toLowerCase().includes(q) ||
          (u.name?.toLowerCase().includes(q) ?? false)
        )
      })
      .sort((a, b) => a.userID.localeCompare(b.userID, undefined, { sensitivity: "base" }))
  }, [sharePickerUsers, shareUserSearch])

  const filteredShareGroups = useMemo(() => {
    const q = shareGroupSearch.trim().toLowerCase()
    const list = Array.isArray(sharePickerGroups) ? sharePickerGroups : []
    return list
      .map((g) => g.groupName || g.name || g.id || "")
      .filter(Boolean)
      .filter((name) => !q || name.toLowerCase().includes(q))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
  }, [sharePickerGroups, shareGroupSearch])

  const toggleShareUser = (userId: string) => {
    setSelectedShareUsers((prev: Set<string>) => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  const toggleShareGroup = (name: string) => {
    setSelectedShareGroups((prev: Set<string>) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const currentRangeLabel = useMemo(() => {
    const entry = accessibleRanges.find((r: RangeAccessEntry) => r.rangeID === selectedRangeId)
    return entry?.rangeID ?? selectedRangeId ?? null
  }, [accessibleRanges, selectedRangeId])

  const createPayloadBase = () => {
    const blueprintID = newBpId.trim()
    const name = newBpName.trim()
    const description = newBpDesc.trim()
    return {
      blueprintID,
      ...(name ? { name } : {}),
      ...(description ? { description } : {}),
    }
  }

  const resetCreateDialog = () => {
    setNewBpId("")
    setNewBpName("")
    setNewBpDesc("")
    setCreateYaml("")
    setCreateTab("from-range")
    setCreateSourceRangeId("")
  }

  const handleCreateFromRange = async () => {
    const { blueprintID, ...rest } = createPayloadBase()
    if (!blueprintID) {
      toast({ variant: "destructive", title: "Blueprint ID required" })
      return
    }
    if (!createSourceRangeId) {
      toast({
        variant: "destructive",
        title: "Select a range",
        description: "Choose one of your ranges to snapshot as this blueprint.",
      })
      return
    }
    setCreating(true)
    const result = await ludusApi.createBlueprintFromRange({
      ...rest,
      blueprintID,
      rangeID: createSourceRangeId,
    })
    if (result.error) {
      toast({ variant: "destructive", title: "Error", description: result.error })
    } else {
      toast({ title: "Blueprint created", description: `From range ${createSourceRangeId}` })
      setCreateDialog(false)
      resetCreateDialog()
      invalidateBlueprints()
    }
    setCreating(false)
  }

  const handleCreateFromYaml = async () => {
    const { blueprintID, ...rest } = createPayloadBase()
    if (!blueprintID) {
      toast({ variant: "destructive", title: "Blueprint ID required" })
      return
    }
    const yaml = createYaml.trim()
    if (!yaml) {
      toast({ variant: "destructive", title: "YAML required", description: "Paste or type your blueprint configuration." })
      return
    }
    if (!createSourceRangeId) {
      toast({
        variant: "destructive",
        title: "Select a range",
        description: "Ludus creates the blueprint from a range first; your YAML then replaces the stored config.",
      })
      return
    }
    setCreating(true)
    const created = await ludusApi.createBlueprintFromRange({
      ...rest,
      blueprintID,
      rangeID: createSourceRangeId,
    })
    if (created.error) {
      toast({ variant: "destructive", title: "Could not create blueprint", description: created.error })
      setCreating(false)
      return
    }
    const cfg = await ludusApi.updateBlueprintConfig(blueprintID, yaml)
    if (cfg.error) {
      toast({
        variant: "destructive",
        title: "Blueprint created but config upload failed",
        description: cfg.error,
      })
    } else {
      toast({ title: "Blueprint created from YAML" })
      setCreateDialog(false)
      resetCreateDialog()
      invalidateBlueprints()
    }
    setCreating(false)
  }

  const handleApplyToCurrentRange = async () => {
    if (!applyDialogBpId) return
    if (!selectedRangeId) {
      toast({ variant: "destructive", title: "No range selected", description: "Choose a range in the sidebar first." })
      return
    }
    setApplySubmitting("current")
    const result = await ludusApi.applyBlueprint(applyDialogBpId, selectedRangeId)
    if (result.error) {
      toast({ variant: "destructive", title: "Error", description: result.error })
    } else {
      toast({ title: "Blueprint applied", description: "Don't forget to deploy your range" })
      setApplyDialogBpId(null)
      await queryClient.invalidateQueries({ queryKey: queryKeys.rangeStatus(selectedRangeId) })
    }
    setApplySubmitting(null)
  }

  const handleApplyToNewRange = async () => {
    if (!applyDialogBpId) return
    const name = newRangeName.trim()
    const rid = newRangeId.trim()
    if (!name || !rid) {
      toast({ variant: "destructive", title: "Name and Range ID required" })
      return
    }
    setApplySubmitting("new")
    const created = await ludusApi.createRange({ name, rangeID: rid })
    if (created.error) {
      toast({ variant: "destructive", title: "Could not create range", description: created.error })
      setApplySubmitting(null)
      return
    }
    const cfg = await ludusApi.getBlueprintConfig(applyDialogBpId)
    if (cfg.error || !cfg.data) {
      toast({
        variant: "destructive",
        title: "Blueprint config fetch failed",
        description: typeof cfg.error === "string" ? cfg.error : "Unknown error",
      })
      setApplySubmitting(null)
      return
    }
    const raw = cfg.data as unknown
    const yaml =
      (raw as { result?: string })?.result ??
      (typeof raw === "string" ? raw : JSON.stringify(raw, null, 2))
    const applied = await ludusApi.setRangeConfig(yaml, rid, true)
    if (applied.error) {
      toast({ variant: "destructive", title: "Could not apply config to new range", description: applied.error })
      setApplySubmitting(null)
      return
    }
    toast({ title: "Range created", description: "Blueprint config applied. Deploy when ready." })
    setApplyDialogBpId(null)
    setNewRangeName("")
    setNewRangeId("")
    await refreshRanges()
    selectRange(rid)
    await queryClient.invalidateQueries({ queryKey: queryKeys.rangeStatus(rid) })
    setApplySubmitting(null)
  }

  const handleView = async (id: string) => {
    const result = await ludusApi.getBlueprintConfig(id)
    if (result.error) {
      toast({ variant: "destructive", title: "Error", description: String(result.error) })
    } else {
      const data = result.data as unknown
      const yaml = (data as { result?: string })?.result || (typeof data === "string" ? data : JSON.stringify(data, null, 2))
      setViewDialog({ id, yaml })
    }
  }

  const handleCopy = async (id: string) => {
    const result = await ludusApi.copyBlueprint(id)
    if (result.error) {
      toast({ variant: "destructive", title: "Error", description: result.error })
    } else {
      toast({ title: "Blueprint copied" })
      invalidateBlueprints()
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm(`Delete blueprint "${id}"?`)) return
    const result = await ludusApi.deleteBlueprint(id)
    if (result.error) {
      toast({ variant: "destructive", title: "Error", description: result.error })
    } else {
      toast({ title: "Blueprint deleted" })
      invalidateBlueprints()
    }
  }

  const handleShare = async () => {
    if (!shareDialog) return
    if (selectedShareUsers.size === 0 && selectedShareGroups.size === 0) {
      toast({ variant: "destructive", title: "Select at least one user or group" })
      return
    }
    setSharing(true)
    let error: string | undefined
    if (selectedShareUsers.size > 0) {
      const r = await ludusApi.shareBlueprintWithUsers(shareDialog, Array.from(selectedShareUsers))
      if (r.error) error = r.error
    }
    if (!error && selectedShareGroups.size > 0) {
      const r = await ludusApi.shareBlueprintWithGroups(shareDialog, Array.from(selectedShareGroups))
      if (r.error) error = r.error
    }
    if (error) {
      toast({ variant: "destructive", title: "Error", description: error })
    } else {
      toast({ title: "Blueprint shared" })
      await queryClient.invalidateQueries({ queryKey: queryKeys.blueprintSharing(shareDialog) })
      await queryClient.invalidateQueries({ queryKey: queryKeys.blueprints() })
      setShareDialog(null)
      setShareUserSearch("")
      setShareGroupSearch("")
      setSelectedShareUsers(new Set())
      setSelectedShareGroups(new Set())
    }
    setSharing(false)
  }

  const handleUnshareUser = async (userId: string) => {
    if (!shareDialog) return
    if (!confirm(`Remove direct blueprint access for user "${userId}"?`)) return
    setUnsharingUserId(userId)
    try {
      const r = await ludusApi.unshareBlueprintFromUsers(shareDialog, [userId])
      const bulkErrs = bulkBlueprintErrors(r.data)
      if (r.error) {
        toast({ variant: "destructive", title: "Error", description: r.error })
      } else if (bulkErrs.length > 0) {
        toast({
          variant: "destructive",
          title: "Unshare failed",
          description: bulkErrs.map((e) => `${e.item}: ${e.reason}`).join("; "),
        })
      } else {
        toast({ title: "Access removed", description: userId })
      }
      if (!r.error) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.blueprintSharing(shareDialog) })
        await queryClient.invalidateQueries({ queryKey: queryKeys.blueprints(), exact: false })
      }
    } finally {
      setUnsharingUserId(null)
    }
  }

  const handleUnshareGroup = async (groupName: string) => {
    if (!shareDialog) return
    if (!confirm(`Remove blueprint access for group "${groupName}"?`)) return
    setUnsharingGroupName(groupName)
    try {
      const r = await ludusApi.unshareBlueprintFromGroups(shareDialog, [groupName])
      const bulkErrs = bulkBlueprintErrors(r.data)
      if (r.error) {
        toast({ variant: "destructive", title: "Error", description: r.error })
      } else if (bulkErrs.length > 0) {
        toast({
          variant: "destructive",
          title: "Unshare failed",
          description: bulkErrs.map((e) => `${e.item}: ${e.reason}`).join("; "),
        })
      } else {
        toast({ title: "Group access removed", description: groupName })
      }
      if (!r.error) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.blueprintSharing(shareDialog) })
        await queryClient.invalidateQueries({ queryKey: queryKeys.blueprints(), exact: false })
      }
    } finally {
      setUnsharingGroupName(null)
    }
  }

  const accessBadge = (access: string) => {
    switch (access) {
      case "owner": return <Badge variant="cyan" className="text-xs gap-1"><Crown className="h-2.5 w-2.5" />Owner</Badge>
      case "admin": return <Badge variant="destructive" className="text-xs">Admin</Badge>
      case "direct": return <Badge variant="success" className="text-xs">Shared</Badge>
      case "group": return <Badge variant="secondary" className="text-xs gap-1"><Users className="h-2.5 w-2.5" />Group</Badge>
      default: return <Badge variant="secondary" className="text-xs">{access}</Badge>
    }
  }

  return (
    <div className="space-y-6">
      {/* Actions */}
      <div className="flex gap-2">
        <Button onClick={() => setCreateDialog(true)}>
          <Plus className="h-4 w-4" />
          Create Blueprint
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => void refreshBlueprints()}
          disabled={!blueprintGateReady}
          title="Refresh blueprint list"
        >
          <RefreshCw
            className={cn("h-4 w-4", (loading || blueprintsFetching || !blueprintGateReady) && "animate-spin")}
          />
        </Button>
      </div>

      {/* Blueprint list */}
      {!listReady ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : visibleBlueprints.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-muted-foreground">
            <Package className="h-10 w-10 mb-3 opacity-40" />
            <p>No blueprints</p>
            <p className="text-xs mt-1">Create a blueprint from a range you own or paste YAML</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {visibleBlueprints.map((bp, bpIndex) => {
            const bpId = bp.id || bp.blueprintID || ""
            const shareRow = sharingQueries[bpIndex]?.data
            const shareLoading = !!sharingQueries[bpIndex]?.isLoading
            return (
              <Card key={bpId} className="hover:border-border/80 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <code className="font-mono text-sm font-medium text-primary">{bpId}</code>
                        {bp.name && <span className="text-sm text-foreground">{bp.name}</span>}
                        {bp.access && accessBadge(bp.access)}
                      </div>
                      {bp.description && (
                        <p className="text-xs text-muted-foreground mt-1">{bp.description}</p>
                      )}
                      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                        {bp.ownerID && <span>Owner: <code className="font-mono">{bp.ownerID}</code></span>}
                        {(bp.sharedUsers ?? 0) > 0 && <span>{bp.sharedUsers} user(s)</span>}
                        {(bp.sharedGroups ?? 0) > 0 && <span>{bp.sharedGroups} group(s)</span>}
                        {(bp.updatedAt || bp.updated) && <span>Updated {formatDate((bp.updatedAt || bp.updated)!)}</span>}
                      </div>
                      {shareLoading && (
                        <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Loading share list…
                        </div>
                      )}
                      {!shareLoading && shareRow && (shareRow.users.length > 0 || shareRow.groups.length > 0) && (
                        <div className="mt-2 space-y-1.5 text-xs border-t border-border/50 pt-2">
                          {shareRow.users.length > 0 && (
                            <p>
                              <span className="text-muted-foreground font-medium">Shared users: </span>
                              {shareRow.users.map((u) => (
                                <span key={u.userID} className="inline mr-2 font-mono text-foreground/90">
                                  {u.userID}{u.name ? <span className="text-muted-foreground font-sans"> ({u.name})</span> : null}
                                  {formatBlueprintAccessLabel(u.access) ? (
                                    <span className="text-muted-foreground font-sans"> — {formatBlueprintAccessLabel(u.access)}</span>
                                  ) : null}
                                  {u.groups && u.groups.length > 0 ? (
                                    <span className="text-muted-foreground font-sans"> [groups: {u.groups.join(", ")}]</span>
                                  ) : null}
                                </span>
                              ))}
                            </p>
                          )}
                          {shareRow.groups.length > 0 && (
                            <p>
                              <span className="text-muted-foreground font-medium">Shared groups: </span>
                              {shareRow.groups.map((g) => (
                                <span key={g.groupName} className="inline mr-2 font-mono text-foreground/90">
                                  {g.groupName}
                                </span>
                              ))}
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-1 flex-shrink-0 ml-4">
                      <Button size="icon-sm" variant="ghost" onClick={() => handleView(bpId)} title="View config">
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon-sm" variant="ghost" onClick={() => setApplyDialogBpId(bpId)} title="Apply to range">
                        <Play className="h-3.5 w-3.5 text-green-400" />
                      </Button>
                      <Button size="icon-sm" variant="ghost" onClick={() => handleCopy(bpId)} title="Copy blueprint">
                        <Copy className="h-3.5 w-3.5 text-blue-400" />
                      </Button>
                      {(!bp.access || bp.access === "owner" || bp.access === "admin") && (
                        <>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => {
                              setShareUserSearch("")
                              setShareGroupSearch("")
                              setSelectedShareUsers(new Set())
                              setSelectedShareGroups(new Set())
                              setShareDialog(bpId)
                            }}
                            title="Share"
                          >
                            <Share2 className="h-3.5 w-3.5 text-cyan-400" />
                          </Button>
                          <Button size="icon-sm" variant="ghost" onClick={() => handleDelete(bpId)} title="Delete">
                            <Trash2 className="h-3.5 w-3.5 text-red-400" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Create dialog */}
      <Dialog
        open={createDialog}
        onOpenChange={(open) => {
          setCreateDialog(open)
          if (!open) resetCreateDialog()
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create blueprint</DialogTitle>
            <DialogDescription>
              {createTab === "from-range"
                ? "Save a range configuration you own as a reusable blueprint."
                : "Create a blueprint, then set its config from your YAML (any range you pick is only used for the initial API call)."}
            </DialogDescription>
          </DialogHeader>
          <Tabs value={createTab} onValueChange={(v) => setCreateTab(v as "from-range" | "yaml")} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="from-range" className="gap-1.5">
                <Package className="h-3.5 w-3.5" />
                From range
              </TabsTrigger>
              <TabsTrigger value="yaml" className="gap-1.5">
                <FileCode className="h-3.5 w-3.5" />
                Paste YAML
              </TabsTrigger>
            </TabsList>
            <TabsContent value="from-range" className="space-y-3 pt-3">
              <div className="space-y-1.5">
                <Label htmlFor="new-bp-id">Blueprint ID <span className="text-red-400">*</span></Label>
                <Input
                  id="new-bp-id"
                  placeholder="my-blueprint"
                  value={newBpId}
                  onChange={(e) => setNewBpId(e.target.value)}
                  className="font-mono"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleCreateFromRange()
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-bp-name">Display name</Label>
                <Input
                  id="new-bp-name"
                  placeholder="Optional"
                  value={newBpName}
                  onChange={(e) => setNewBpName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-bp-desc">Description</Label>
                <Input
                  id="new-bp-desc"
                  placeholder="Optional"
                  value={newBpDesc}
                  onChange={(e) => setNewBpDesc(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Range to copy from <span className="text-red-400">*</span></Label>
                <p className="text-xs text-muted-foreground">
                  Only ranges returned by <code className="text-[10px]">GET /range</code> (ranges you own). Group-shared ranges without direct ownership are not listed.
                </p>
                {loadingOwnedRanges ? (
                  <div className="flex items-center gap-2 h-10 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading your ranges…
                  </div>
                ) : ownedRanges.length === 0 ? (
                  <p className="text-sm text-amber-600/90 dark:text-amber-400/90">
                    No owned ranges found. Deploy a range under this account first.
                  </p>
                ) : (
                  <Select value={createSourceRangeId} onValueChange={setCreateSourceRangeId}>
                    <SelectTrigger className="font-mono text-left">
                      <SelectValue placeholder="Select range" />
                    </SelectTrigger>
                    <SelectContent>
                      {ownedRanges.map((r: RangeObject) => (
                        <SelectItem
                          key={r.rangeID}
                          value={r.rangeID}
                          className="font-mono"
                          textValue={`${r.rangeID}${r.name ? ` ${r.name}` : ""}`}
                        >
                          {r.name ? `${r.rangeID} (${r.name})` : r.rangeID}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </TabsContent>
            <TabsContent value="yaml" className="space-y-3 pt-3">
              <div className="space-y-1.5">
                <Label htmlFor="new-bp-id-yaml">Blueprint ID <span className="text-red-400">*</span></Label>
                <Input
                  id="new-bp-id-yaml"
                  placeholder="my-blueprint"
                  value={newBpId}
                  onChange={(e) => setNewBpId(e.target.value)}
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-bp-name-yaml">Display name</Label>
                <Input
                  id="new-bp-name-yaml"
                  placeholder="Optional"
                  value={newBpName}
                  onChange={(e) => setNewBpName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-bp-desc-yaml">Description</Label>
                <Input
                  id="new-bp-desc-yaml"
                  placeholder="Optional"
                  value={newBpDesc}
                  onChange={(e) => setNewBpDesc(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Range for API bootstrap <span className="text-red-400">*</span></Label>
                <p className="text-xs text-muted-foreground">
                  Ludus creates the blueprint from an existing range, then this flow uploads your YAML as the blueprint config, replacing that copy. Your live range is not modified.
                </p>
                {loadingOwnedRanges ? (
                  <div className="flex items-center gap-2 h-10 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading your ranges…
                  </div>
                ) : ownedRanges.length === 0 ? (
                  <p className="text-sm text-amber-600/90 dark:text-amber-400/90">
                    No owned ranges found. Deploy a range under this account first.
                  </p>
                ) : (
                  <Select value={createSourceRangeId} onValueChange={setCreateSourceRangeId}>
                    <SelectTrigger className="font-mono text-left">
                      <SelectValue placeholder="Select range" />
                    </SelectTrigger>
                    <SelectContent>
                      {ownedRanges.map((r: RangeObject) => (
                        <SelectItem
                          key={r.rangeID}
                          value={r.rangeID}
                          className="font-mono"
                          textValue={`${r.rangeID}${r.name ? ` ${r.name}` : ""}`}
                        >
                          {r.name ? `${r.rangeID} (${r.name})` : r.rangeID}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="create-yaml">Blueprint YAML <span className="text-red-400">*</span></Label>
                <Textarea
                  id="create-yaml"
                  placeholder="# ludus range config…"
                  value={createYaml}
                  onChange={(e) => setCreateYaml(e.target.value)}
                  className="font-mono text-xs min-h-[200px] max-h-[40vh]"
                  spellCheck={false}
                />
              </div>
            </TabsContent>
          </Tabs>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => { setCreateDialog(false); resetCreateDialog() }}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                void (createTab === "from-range" ? handleCreateFromRange() : handleCreateFromYaml())
              }
              disabled={
                creating ||
                !newBpId.trim() ||
                !createSourceRangeId ||
                ownedRanges.length === 0 ||
                loadingOwnedRanges ||
                (createTab === "yaml" && !createYaml.trim())
              }
            >
              {creating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : createTab === "yaml" ? (
                <FileCode className="h-4 w-4" />
              ) : (
                <Package className="h-4 w-4" />
              )}
              Create blueprint
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View YAML dialog */}
      {viewDialog && (
        <Dialog open={!!viewDialog} onOpenChange={() => setViewDialog(null)}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Blueprint Config — {viewDialog.id}</DialogTitle>
            </DialogHeader>
            <pre className="bg-black/60 rounded-md p-4 text-xs font-mono text-green-400 overflow-auto max-h-96 whitespace-pre-wrap">
              {viewDialog.yaml}
            </pre>
            <DialogFooter>
              <Button onClick={() => setViewDialog(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Share dialog */}
      {shareDialog && (
        <Dialog
          open={!!shareDialog}
          onOpenChange={(open) => {
            if (!open) setShareDialog(null)
          }}
        >
          <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Share Blueprint — {shareDialog}</DialogTitle>
            </DialogHeader>
            {loadingShareDialogAccess ? (
              <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading current shares…
              </div>
            ) : (
              <div className="rounded-md border border-border p-3 text-xs space-y-3 mb-1">
                <p className="font-medium text-foreground text-sm">Who has access</p>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Remove revokes direct shares or group shares. Users who only had access via a removed group disappear
                  from this list after refresh.
                </p>
                {shareDialogAccess && shareDialogAccess.users.length > 0 ? (
                  <ul className="space-y-1">
                    {shareDialogAccess.users.map((u) => {
                      const busy = unsharingUserId === u.userID
                      return (
                        <li
                          key={u.userID}
                          className="flex items-center justify-between gap-2 rounded bg-muted/40 px-2 py-1.5"
                        >
                          <div className="min-w-0">
                            <div className="font-mono text-foreground/90">{u.userID}</div>
                            {u.name && <div className="text-muted-foreground truncate">{u.name}</div>}
                            {formatBlueprintAccessLabel(u.access) ? (
                              <div className="text-muted-foreground mt-0.5">
                                {formatBlueprintAccessLabel(u.access)}
                              </div>
                            ) : null}
                            {u.groups && u.groups.length > 0 ? (
                              <div className="text-muted-foreground mt-0.5">via groups: {u.groups.join(", ")}</div>
                            ) : null}
                          </div>
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            className="shrink-0 text-red-400 hover:text-red-300"
                            title="Remove user access"
                            disabled={!!unsharingUserId || !!unsharingGroupName}
                            onClick={() => void handleUnshareUser(u.userID)}
                          >
                            {busy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </li>
                      )
                    })}
                  </ul>
                ) : null}
                {shareDialogAccess && shareDialogAccess.groups.length > 0 ? (
                  <ul className="space-y-1">
                    {shareDialogAccess.groups.map((g) => {
                      const busy = unsharingGroupName === g.groupName
                      return (
                        <li
                          key={g.groupName}
                          className="flex items-center justify-between gap-2 rounded bg-muted/40 px-2 py-1.5"
                        >
                          <div className="min-w-0 font-mono text-foreground/90">{g.groupName}</div>
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            className="shrink-0 text-red-400 hover:text-red-300"
                            title="Remove group access"
                            disabled={!!unsharingUserId || !!unsharingGroupName}
                            onClick={() => void handleUnshareGroup(g.groupName)}
                          >
                            {busy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </li>
                      )
                    })}
                  </ul>
                ) : null}
                {shareDialogAccess &&
                  shareDialogAccess.users.length === 0 &&
                  shareDialogAccess.groups.length === 0 && (
                  <p className="text-muted-foreground">Not shared with other users or groups yet.</p>
                )}
              </div>
            )}
            <Tabs defaultValue="users" className="py-2">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="users">Users</TabsTrigger>
                <TabsTrigger value="groups">Groups</TabsTrigger>
              </TabsList>
              <TabsContent value="users" className="space-y-2 mt-3">
                <Label>Search users</Label>
                <Input
                  placeholder="Filter by ID or name…"
                  value={shareUserSearch}
                  onChange={(e) => setShareUserSearch(e.target.value)}
                />
                <ScrollArea className="h-[200px] rounded-md border border-border p-2">
                  {loadingShareUsers ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : filteredShareUsers.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-4 text-center">No users</p>
                  ) : (
                    <ul className="space-y-1">
                      {filteredShareUsers.map((u) => (
                        <li key={u.userID}>
                          <label className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted/50 cursor-pointer">
                            <Checkbox
                              checked={selectedShareUsers.has(u.userID)}
                              onCheckedChange={() => toggleShareUser(u.userID)}
                            />
                            <span className="font-mono text-xs">{u.userID}</span>
                            {u.name && (
                              <span className="text-xs text-muted-foreground truncate">{u.name}</span>
                            )}
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </ScrollArea>
                <p className="text-xs text-muted-foreground">{selectedShareUsers.size} user(s) selected</p>
              </TabsContent>
              <TabsContent value="groups" className="space-y-2 mt-3">
                <Label>Search groups</Label>
                <Input
                  placeholder="Filter by group name…"
                  value={shareGroupSearch}
                  onChange={(e) => setShareGroupSearch(e.target.value)}
                />
                <ScrollArea className="h-[200px] rounded-md border border-border p-2">
                  {loadingShareGroups ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : filteredShareGroups.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-4 text-center">No groups</p>
                  ) : (
                    <ul className="space-y-1">
                      {filteredShareGroups.map((name) => (
                        <li key={name}>
                          <label className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted/50 cursor-pointer">
                            <Checkbox
                              checked={selectedShareGroups.has(name)}
                              onCheckedChange={() => toggleShareGroup(name)}
                            />
                            <span className="text-sm">{name}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </ScrollArea>
                <p className="text-xs text-muted-foreground">{selectedShareGroups.size} group(s) selected</p>
              </TabsContent>
            </Tabs>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setShareDialog(null)}>Cancel</Button>
              <Button
                onClick={() => void handleShare()}
                disabled={
                  sharing ||
                  (selectedShareUsers.size === 0 && selectedShareGroups.size === 0)
                }
              >
                {sharing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
                Share
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Apply blueprint dialog */}
      {applyDialogBpId && (
        <Dialog
          open={!!applyDialogBpId}
          onOpenChange={(open) => {
            if (!open) {
              setApplyDialogBpId(null)
              setNewRangeName("")
              setNewRangeId("")
            }
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Apply blueprint</DialogTitle>
              <DialogDescription>
                Choose how to use <code className="font-mono text-primary">{applyDialogBpId}</code>.
                Applying overwrites range configuration for the target range; deploy afterward.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="rounded-md border border-border p-3 space-y-2">
                <p className="text-sm font-medium">Current range</p>
                {currentRangeLabel ? (
                  <p className="text-xs text-muted-foreground font-mono">{currentRangeLabel}</p>
                ) : (
                  <p className="text-xs text-destructive">No range selected — pick one in the sidebar.</p>
                )}
                <Button
                  className="w-full gap-2"
                  onClick={() => void handleApplyToCurrentRange()}
                  disabled={applySubmitting !== null || !selectedRangeId}
                >
                  {applySubmitting === "current" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 text-green-400" />
                  )}
                  Apply to current range
                </Button>
              </div>
              <div className="rounded-md border border-border p-3 space-y-2">
                <p className="text-sm font-medium">New range</p>
                <p className="text-xs text-muted-foreground">
                  Creates a range under your current account, copies this blueprint&apos;s YAML onto it, then selects it.
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="apply-new-name">Display name</Label>
                  <Input
                    id="apply-new-name"
                    value={newRangeName}
                    onChange={(e) => setNewRangeName(e.target.value)}
                    placeholder="My lab"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="apply-new-id">Range ID</Label>
                  <Input
                    id="apply-new-id"
                    className="font-mono"
                    value={newRangeId}
                    onChange={(e) => setNewRangeId(e.target.value)}
                    placeholder="my-lab-range"
                  />
                </div>
                <Button
                  variant="secondary"
                  className="w-full gap-2"
                  onClick={() => void handleApplyToNewRange()}
                  disabled={applySubmitting !== null || !newRangeName.trim() || !newRangeId.trim()}
                >
                  {applySubmitting === "new" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  Create range and apply blueprint
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setApplyDialogBpId(null)}>Cancel</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}