"use client"

import { useState, useMemo, useCallback } from "react"
import { useQuery, useQueries, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { STALE } from "@/lib/query-client"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Users2,
  Plus,
  Trash2,
  RefreshCw,
  UserPlus,
  Server,
  Loader2,
  ChevronRight,
  ChevronDown,
  User,
  Power,
} from "lucide-react"
import { ludusApi } from "@/lib/api"
import type { GroupObject, UserObject, RangeObject } from "@/lib/types"
import { useToast } from "@/hooks/use-toast"
import { cn, parseLudusGroupList } from "@/lib/utils"
import { useRange } from "@/lib/range-context"
import { useEffectiveScopeTag } from "@/lib/effective-scope-context"
import { findLudusRangeRouterVm, isLudusVmRunning } from "@/lib/ludus-range-router-vm"
import { tryToastLudusSlowHttpError } from "@/lib/ludus-timeout-ui"

/** GET /groups only returns counts — members/ranges come from sub-resources ([Ludus API](https://api-docs.ludus.cloud/list-all-groups-24252024e0)). */
type GroupDetail = { members: string[]; ranges: string[] }

function normalizeGroupRangeList(data: unknown): string[] {
  if (data == null) return []
  if (Array.isArray(data)) {
    if (data.length === 0) return []
    if (typeof data[0] === "string") return data as string[]
    return (data as { rangeID?: string; id?: string }[])
      .map((r) => r.rangeID || r.id || "")
      .filter(Boolean)
  }
  if (typeof data === "object" && data !== null && "result" in data) {
    return normalizeGroupRangeList((data as { result: unknown }).result)
  }
  return []
}

function userIdsFromMemberPayload(data: unknown): string[] {
  if (!Array.isArray(data)) return []
  return (data as UserObject[]).map((u) => u.userID).filter(Boolean)
}

function bulkGroupErrorsFromArray(errors: unknown): { item: string; reason: string }[] {
  if (!Array.isArray(errors)) return []
  return errors.filter(
    (e): e is { item: string; reason: string } =>
      !!e &&
      typeof e === "object" &&
      typeof (e as { item?: string }).item === "string" &&
      typeof (e as { reason?: string }).reason === "string",
  )
}

/** Ludus may return `{ success, errors }` or wrap in `{ result: { … } }`. */
function ludusUnwrappedBulkGroupOp(data: unknown): {
  success: string[]
  errors: { item: string; reason: string }[]
} | null {
  if (data == null || typeof data !== "object") return null
  const o = data as Record<string, unknown>
  let p: Record<string, unknown> = o
  const topHas = Array.isArray(o.success) || Array.isArray(o.errors)
  if (
    !topHas &&
    o.result != null &&
    typeof o.result === "object" &&
    !Array.isArray(o.result)
  ) {
    p = o.result as Record<string, unknown>
  }
  const has = Array.isArray(p.success) || Array.isArray(p.errors)
  if (!has) return null
  const success = Array.isArray(p.success) ? p.success.map(String) : []
  const errors = bulkGroupErrorsFromArray(p.errors)
  return { success, errors }
}

function bulkGroupErrors(data: unknown): { item: string; reason: string }[] {
  return ludusUnwrappedBulkGroupOp(data)?.errors ?? []
}

/** When Ludus returns a structured bulk response, require `rangeId` in `success`. */
function bulkGroupRemovalAcknowledgesRange(data: unknown, rangeId: string): boolean {
  const u = ludusUnwrappedBulkGroupOp(data)
  if (!u) return true
  if (u.errors.length > 0) return true
  if (u.success.length === 0) return true
  return u.success.includes(rangeId)
}

async function fetchGroupDetail(groupName: string): Promise<GroupDetail> {
  const [ur, rr] = await Promise.all([
    ludusApi.listGroupMembers(groupName),
    ludusApi.listGroupRanges(groupName),
  ])
  const members = !ur.error && ur.data != null ? userIdsFromMemberPayload(ur.data) : []
  const ranges = !rr.error && rr.data != null ? normalizeGroupRangeList(rr.data) : []
  return { members, ranges }
}

function groupDisplayName(group: GroupObject) {
  return group.name ?? group.groupName ?? group.id ?? "unknown"
}

function asGroupObjectArray(data: unknown): GroupObject[] {
  return parseLudusGroupList<GroupObject>(data)
}

function asRangeObjectArray(data: unknown): RangeObject[] {
  if (data == null) return []
  if (Array.isArray(data)) return data as RangeObject[]
  if (typeof data === "object" && data !== null && "result" in data) {
    const inner = (data as { result: unknown }).result
    if (Array.isArray(inner)) return inner as RangeObject[]
    if (inner && typeof inner === "object") return [inner as RangeObject]
    return []
  }
  if (typeof data === "object") return [data as RangeObject]
  return []
}

function asUserObjectArray(data: unknown): UserObject[] {
  if (data == null) return []
  if (Array.isArray(data)) return data as UserObject[]
  if (typeof data === "object" && data !== null && "result" in data) {
    const inner = (data as { result: unknown }).result
    if (Array.isArray(inner)) return inner as UserObject[]
    if (inner && typeof inner === "object") return [inner as UserObject]
    return []
  }
  return []
}

/** Poll until router VM shows running (same cadence as remove-range-from-group dialog). */
function pollRangeStatusWhileRouterOff(q: { state: { data: unknown } }): number | false {
  const d = q.state.data as RangeObject | undefined
  if (!d?.VMs?.length) return false
  const router = findLudusRangeRouterVm(d.VMs)
  if (!router) return false
  return isLudusVmRunning(router) ? false : 2500
}

export function GroupsPageClient() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const scopeTag = useEffectiveScopeTag()
  const { refreshRanges } = useRange()
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [createDialog, setCreateDialog] = useState(false)
  const [newGroupName, setNewGroupName] = useState("")
  const [creating, setCreating] = useState(false)
  const [addUserDialog, setAddUserDialog] = useState<string | null>(null)
  const [addRangeDialog, setAddRangeDialog] = useState<string | null>(null)
  const [addUserSearch, setAddUserSearch] = useState("")
  const [addRangeSearch, setAddRangeSearch] = useState("")
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(() => new Set())
  const [selectedRangeIds, setSelectedRangeIds] = useState<Set<string>>(() => new Set())
  const [addingUsers, setAddingUsers] = useState(false)
  const [addingRanges, setAddingRanges] = useState(false)
  /** Row-level pending state so remove actions show a spinner instead of feeling stuck. */
  const [removingMember, setRemovingMember] = useState<{ group: string; userId: string } | null>(null)
  const [removingRange, setRemovingRange] = useState<{ group: string; rangeId: string } | null>(null)
  const [removeRangeFromGroupDialog, setRemoveRangeFromGroupDialog] = useState<{
    group: string
    rangeId: string
  } | null>(null)
  const [poweringOnRouterForGroupRemove, setPoweringOnRouterForGroupRemove] = useState(false)
  const [poweringOnRouterForGroupAddRangeId, setPoweringOnRouterForGroupAddRangeId] = useState<string | null>(null)

  const removeRangeDialogRangeId = removeRangeFromGroupDialog?.rangeId

  const removeRangeStatusQuery = useQuery({
    queryKey: queryKeys.rangeStatus(scopeTag, removeRangeDialogRangeId ?? ""),
    queryFn: async () => {
      const id = removeRangeDialogRangeId!
      const r = await ludusApi.getRangeStatus(id)
      if (r.error || !r.data) throw new Error(r.error || "Could not load range status")
      return r.data
    },
    enabled: !!removeRangeDialogRangeId,
    staleTime: 0,
    refetchInterval: pollRangeStatusWhileRouterOff,
  })

  const { data: groupsRaw, isLoading: loading, isFetching: groupsFetching } = useQuery({
    queryKey: queryKeys.groups(scopeTag),
    queryFn: async () => {
      const result = await ludusApi.listGroups()
      return asGroupObjectArray(result.data)
    },
    staleTime: STALE.long,
  })
  const groups = Array.isArray(groupsRaw) ? groupsRaw : []

  /** Group list + detail caches. Skip range refetch unless membership affects /ranges/accessible (e.g. delete group). */
  const invalidateGroups = useCallback(
    async (opts?: { refreshAccessibleRanges?: boolean }) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.groups(scopeTag), exact: false })
      if (opts?.refreshAccessibleRanges) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.accessibleRangesList(scopeTag), exact: false })
        await refreshRanges()
      }
    },
    [queryClient, refreshRanges, scopeTag],
  )

  const { data: pickerUsers = [], isLoading: loadingPickerUsers } = useQuery({
    queryKey: queryKeys.users(scopeTag),
    queryFn: async () => {
      const r = await ludusApi.listAllUsers().catch(() => ludusApi.listUsers())
      return asUserObjectArray(r.data)
    },
    enabled: !!addUserDialog,
    staleTime: STALE.long,
  })

  const { data: pickerRangesRaw, isLoading: loadingPickerRanges } = useQuery({
    queryKey: queryKeys.allRanges(scopeTag),
    queryFn: async () => {
      const r = await ludusApi.listAllRanges()
      if (r.error || r.data == null) return [] as RangeObject[]
      return asRangeObjectArray(r.data)
    },
    enabled: !!addRangeDialog,
    staleTime: STALE.long,
  })
  const pickerRanges = Array.isArray(pickerRangesRaw) ? pickerRangesRaw : []

  const { data: addUserDialogDetail, isLoading: loadingAddUserDetail } = useQuery({
    queryKey: queryKeys.groupDetail(scopeTag, addUserDialog || "_"),
    queryFn: () => fetchGroupDetail(addUserDialog!),
    enabled: !!addUserDialog,
    staleTime: STALE.short,
  })

  const { data: addRangeDialogDetail, isLoading: loadingAddRangeDetail } = useQuery({
    queryKey: queryKeys.groupDetail(scopeTag, addRangeDialog || "_"),
    queryFn: () => fetchGroupDetail(addRangeDialog!),
    enabled: !!addRangeDialog,
    staleTime: STALE.short,
  })

  const expandedSorted = useMemo(() => Array.from(expandedGroups).sort(), [expandedGroups])

  const expandedDetailQueries = useQueries({
    queries: expandedSorted.map((gName) => ({
      queryKey: queryKeys.groupDetail(scopeTag, gName),
      queryFn: () => fetchGroupDetail(gName),
      staleTime: STALE.short,
    })),
  })

  const filteredPickerUsers = useMemo(() => {
    const members = new Set(addUserDialogDetail?.members ?? [])
    const q = addUserSearch.trim().toLowerCase()
    const list = Array.isArray(pickerUsers) ? pickerUsers : []
    return (list as UserObject[])
      .filter((u) => {
        if (members.has(u.userID)) return false
        if (!q) return true
        return (
          u.userID.toLowerCase().includes(q) ||
          (u.name?.toLowerCase().includes(q) ?? false)
        )
      })
      .sort((a, b) => a.userID.localeCompare(b.userID, undefined, { sensitivity: "base" }))
  }, [pickerUsers, addUserDialogDetail, addUserSearch])

  const filteredPickerRanges = useMemo(() => {
    const inGroup = new Set(addRangeDialogDetail?.ranges ?? [])
    const q = addRangeSearch.trim().toLowerCase()
    const list = Array.isArray(pickerRanges) ? pickerRanges : []
    return list
      .filter((r) => {
        if (inGroup.has(r.rangeID)) return false
        if (!q) return true
        const label = `${r.rangeID} ${r.name ?? ""}`.toLowerCase()
        return label.includes(q)
      })
      .sort((a, b) =>
        (a.name || a.rangeID).localeCompare(b.name || b.rangeID, undefined, { sensitivity: "base" })
      )
  }, [pickerRanges, addRangeDialogDetail, addRangeSearch])

  /** Status for every visible picker row plus any checked row that scrolled out of the filter. */
  const addRangeStatusQueryIds = useMemo(() => {
    const s = new Set<string>()
    for (const r of filteredPickerRanges) s.add(r.rangeID)
    for (const id of selectedRangeIds) s.add(id)
    return Array.from(s).sort()
  }, [filteredPickerRanges, selectedRangeIds])

  const addRangePickerStatusQueries = useQueries({
    queries: addRangeStatusQueryIds.map((rangeId) => ({
      queryKey: queryKeys.rangeStatus(scopeTag, rangeId),
      queryFn: async () => {
        const r = await ludusApi.getRangeStatus(rangeId)
        if (r.error || !r.data) throw new Error(r.error || "Could not load range status")
        return r.data
      },
      enabled: !!addRangeDialog && addRangeStatusQueryIds.length > 0,
      staleTime: 0,
      refetchInterval: pollRangeStatusWhileRouterOff,
    })),
  })

  const addRangeStatusById = useMemo(() => {
    const m = new Map<string, (typeof addRangePickerStatusQueries)[number]>()
    addRangeStatusQueryIds.forEach((id, i) => {
      const q = addRangePickerStatusQueries[i]
      if (q) m.set(id, q)
    })
    return m
  }, [addRangeStatusQueryIds, addRangePickerStatusQueries])

  const addRangesSubmitEnabled = useMemo(() => {
    if (selectedRangeIds.size === 0) return false
    for (const id of selectedRangeIds) {
      const q = addRangeStatusById.get(id)
      if (!q || q.isPending || q.isError) return false
      const data = q.data as RangeObject | undefined
      if (!data) return false
      const router = findLudusRangeRouterVm(data.VMs ?? [])
      if (router && !isLudusVmRunning(router)) return false
    }
    return true
  }, [selectedRangeIds, addRangeStatusById])

  const selectedRangesHiddenByFilter = useMemo(() => {
    const visible = new Set(filteredPickerRanges.map((r) => r.rangeID))
    return Array.from(selectedRangeIds).filter((id) => !visible.has(id))
  }, [selectedRangeIds, filteredPickerRanges])

  const toggleUserPicker = (userId: string) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  const toggleRangePicker = (rangeId: string) => {
    setSelectedRangeIds((prev) => {
      const next = new Set(prev)
      if (next.has(rangeId)) next.delete(rangeId)
      else next.add(rangeId)
      return next
    })
  }

  const toggleGroup = (name: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const handleCreate = async () => {
    if (!newGroupName.trim()) return
    setCreating(true)
    const result = await ludusApi.createGroup(newGroupName)
    if (result.error) {
      toast({ variant: "destructive", title: "Error", description: result.error })
    } else {
      toast({ title: "Group created", description: newGroupName })
      setCreateDialog(false)
      setNewGroupName("")
      await invalidateGroups()
    }
    setCreating(false)
  }

  const handleDelete = async (name: string) => {
    if (!confirm(`Delete group "${name}"?`)) return
    const result = await ludusApi.deleteGroup(name)
    if (result.error) {
      toast({ variant: "destructive", title: "Error", description: result.error })
    } else {
      toast({ title: "Group deleted" })
      await invalidateGroups({ refreshAccessibleRanges: true })
    }
  }

  const handleAddUser = async () => {
    if (!addUserDialog) return
    if (selectedUserIds.size === 0) {
      toast({ variant: "destructive", title: "Select at least one user" })
      return
    }
    setAddingUsers(true)
    const result = await ludusApi.addUsersToGroup(addUserDialog, Array.from(selectedUserIds))
    const bulkErrs = bulkGroupErrors(result.data)
    if (result.error) {
      toast({ variant: "destructive", title: "Error", description: result.error })
    } else if (bulkErrs.length > 0) {
      toast({
        variant: "destructive",
        title: "Some users were not added",
        description: bulkErrs.map((e) => `${e.item}: ${e.reason}`).join("; "),
      })
      await invalidateGroups()
      setAddingUsers(false)
      return
    } else {
      toast({ title: "Users added" })
      setAddUserDialog(null)
      setAddUserSearch("")
      setSelectedUserIds(new Set())
      await invalidateGroups()
    }
    setAddingUsers(false)
  }

  const handleAddRange = async () => {
    if (!addRangeDialog) return
    if (selectedRangeIds.size === 0) {
      toast({ variant: "destructive", title: "Select at least one range" })
      return
    }
    setAddingRanges(true)
    const result = await ludusApi.addRangesToGroup(addRangeDialog, Array.from(selectedRangeIds))
    const bulkErrs = bulkGroupErrors(result.data)
    if (result.error) {
      toast({ variant: "destructive", title: "Error", description: result.error })
    } else if (bulkErrs.length > 0) {
      toast({
        variant: "destructive",
        title: "Some ranges were not added",
        description: bulkErrs.map((e) => `${e.item}: ${e.reason}`).join("; "),
      })
      await invalidateGroups()
      setAddingRanges(false)
      return
    } else {
      toast({ title: "Ranges added" })
      setPoweringOnRouterForGroupAddRangeId(null)
      setAddRangeDialog(null)
      setAddRangeSearch("")
      setSelectedRangeIds(new Set())
      await invalidateGroups()
    }
    setAddingRanges(false)
  }

  const handleRemoveUser = async (groupName: string, userId: string) => {
    setRemovingMember({ group: groupName, userId })
    try {
      const result = await ludusApi.removeUsersFromGroup(groupName, [userId])
      const bulkErrs = bulkGroupErrors(result.data)
      if (result.error) {
        toast({ variant: "destructive", title: "Error", description: result.error })
      } else if (bulkErrs.length > 0) {
        toast({
          variant: "destructive",
          title: "Remove failed",
          description: bulkErrs.map((e) => `${e.item}: ${e.reason}`).join("; "),
        })
      } else {
        toast({ title: "User removed", description: `${userId} removed from ${groupName}` })
      }
      if (!result.error) await invalidateGroups()
    } finally {
      setRemovingMember(null)
    }
  }

  const handlePowerOnRouterForGroupRemove = async () => {
    const dlg = removeRangeFromGroupDialog
    const data = removeRangeStatusQuery.data
    if (!dlg || !data?.VMs?.length) return
    const router = findLudusRangeRouterVm(data.VMs)
    if (!router) return
    const name = (router.name || router.vmName || "").trim()
    if (!name) return
    setPoweringOnRouterForGroupRemove(true)
    try {
      const res = await ludusApi.powerOn([name], dlg.rangeId)
      if (res.error) {
        if (
          !tryToastLudusSlowHttpError({
            toast,
            error: res.error,
            slowTitle: "Slow response from Ludus",
            onSlow: () => {
              void removeRangeStatusQuery.refetch()
            },
          })
        ) {
          toast({ variant: "destructive", title: "Power on failed", description: res.error })
        }
      } else {
        toast({ title: "Powering on router", description: name })
        await queryClient.invalidateQueries({
          queryKey: queryKeys.rangeStatus(scopeTag, dlg.rangeId),
        })
      }
    } finally {
      setPoweringOnRouterForGroupRemove(false)
    }
  }

  const handlePowerOnRouterForGroupAdd = async (rangeId: string, data: RangeObject | undefined) => {
    if (!addRangeDialog || !data?.VMs?.length) return
    const router = findLudusRangeRouterVm(data.VMs)
    if (!router) return
    const name = (router.name || router.vmName || "").trim()
    if (!name) return
    setPoweringOnRouterForGroupAddRangeId(rangeId)
    try {
      const res = await ludusApi.powerOn([name], rangeId)
      if (res.error) {
        if (
          !tryToastLudusSlowHttpError({
            toast,
            error: res.error,
            slowTitle: "Slow response from Ludus",
            onSlow: () => {
              void queryClient.invalidateQueries({ queryKey: queryKeys.rangeStatus(scopeTag, rangeId) })
            },
          })
        ) {
          toast({ variant: "destructive", title: "Power on failed", description: res.error })
        }
      } else {
        toast({ title: "Powering on router", description: name })
        await queryClient.invalidateQueries({ queryKey: queryKeys.rangeStatus(scopeTag, rangeId) })
      }
    } finally {
      setPoweringOnRouterForGroupAddRangeId(null)
    }
  }

  const executeRemoveRangeFromGroup = async () => {
    const dlg = removeRangeFromGroupDialog
    if (!dlg) return
    const data = removeRangeStatusQuery.data
    const router = findLudusRangeRouterVm(data?.VMs ?? [])
    if (router && !isLudusVmRunning(router)) {
      toast({
        variant: "destructive",
        title: "Router is still off",
        description: "Power on the range router VM first, then try again.",
      })
      return
    }
    setRemovingRange({ group: dlg.group, rangeId: dlg.rangeId })
    try {
      const groupName = dlg.group
      const rangeId = dlg.rangeId
      const result = await ludusApi.removeRangesFromGroup(groupName, [rangeId])
      const bulkErrs = bulkGroupErrors(result.data)
      if (result.error) {
        toast({ variant: "destructive", title: "Error", description: result.error })
        return
      }
      if (bulkErrs.length > 0) {
        toast({
          variant: "destructive",
          title: "Remove failed",
          description: bulkErrs.map((e) => `${e.item}: ${e.reason}`).join("; "),
        })
        await invalidateGroups()
        return
      }
      if (!bulkGroupRemovalAcknowledgesRange(result.data, rangeId)) {
        toast({
          variant: "destructive",
          title: "Removal not confirmed",
          description:
            "Ludus did not list this range in the success payload — nothing may have changed. If the range stays in the group, check Ludus server/proxy DELETE body support.",
        })
        await invalidateGroups()
        return
      }
      await invalidateGroups({ refreshAccessibleRanges: true })
      const fresh = await fetchGroupDetail(groupName)
      if (fresh.ranges.includes(rangeId)) {
        toast({
          variant: "destructive",
          title: "Range still in group",
          description:
            "The API returned success but this range is still attached. If the router was off, power it on and try again.",
        })
        return
      }
      setRemoveRangeFromGroupDialog(null)
      toast({ title: "Range removed from group", description: rangeId })
    } finally {
      setRemovingRange(null)
    }
  }

  const rrDlg = removeRangeFromGroupDialog
  const rrRangeData = removeRangeStatusQuery.data
  const rrStatusPending = removeRangeStatusQuery.isPending
  const rrStatusError = removeRangeStatusQuery.isError
  const rrStatusFetching = removeRangeStatusQuery.isFetching
  const rrRouter = findLudusRangeRouterVm(rrRangeData?.VMs ?? [])
  const rrRouterOn = rrRouter ? isLudusVmRunning(rrRouter) : true
  const rrRouterLabel = rrRouter ? (rrRouter.name || rrRouter.vmName || "").trim() : ""
  const rrRemoveEnabled =
    !!rrDlg &&
    !removingRange &&
    !rrStatusPending &&
    !rrStatusError &&
    (!rrRouter || rrRouterOn)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{groups.length} group(s)</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setCreateDialog(true)}>
            <Plus className="h-4 w-4" />
            New Group
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void invalidateGroups()}
            disabled={loading || groupsFetching}
          >
            <RefreshCw className={cn("h-4 w-4", (loading || groupsFetching) && "animate-spin")} />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : groups.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-muted-foreground">
            <Users2 className="h-10 w-10 mb-3 opacity-40" />
            <p>No groups yet</p>
            <p className="text-xs mt-1">Create groups to share ranges between users</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => {
            const gName = groupDisplayName(group)
            const expandedIdx = expandedSorted.indexOf(gName)
            const detailQuery = expandedIdx >= 0 ? expandedDetailQueries[expandedIdx] : undefined
            const detailMembers = detailQuery?.data?.members ?? []
            const detailRanges = detailQuery?.data?.ranges ?? []
            const detailLoading = !!detailQuery?.isLoading
            const memberCount = group.numMembers ?? group.members?.length ?? detailMembers.length
            const rangeCount = group.numRanges ?? group.ranges?.length ?? detailRanges.length
            return (
            <Card key={gName}>
              <button
                className="w-full flex items-center justify-between p-4 text-left hover:bg-muted/30"
                onClick={() => toggleGroup(gName)}
              >
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-md bg-blue-500/20 flex items-center justify-center">
                    <Users2 className="h-4 w-4 text-status-info" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">{gName}</p>
                    <div className="flex gap-3 mt-0.5">
                      <span className="text-xs text-muted-foreground">
                        {memberCount} member(s)
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {rangeCount} range(s)
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDelete(gName)
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-status-error" />
                  </Button>
                  {expandedGroups.has(gName) ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              </button>

              {expandedGroups.has(gName) && (
                <CardContent className="pt-0">
                  <div className="grid grid-cols-2 gap-4">
                    {/* Members */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-semibold text-muted-foreground uppercase">Members</p>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-xs"
                          onClick={() => {
                            setAddUserSearch("")
                            setSelectedUserIds(new Set())
                            setAddUserDialog(gName)
                          }}
                        >
                          <UserPlus className="h-3 w-3" />
                          Add
                        </Button>
                      </div>
                      <div className="space-y-1">
                        {detailLoading && detailMembers.length === 0 ? (
                          <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Loading members…
                          </div>
                        ) : detailMembers.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No members</p>
                        ) : (
                          detailMembers.map((m) => {
                            const memberBusy =
                              removingMember?.group === gName && removingMember?.userId === m
                            return (
                              <div
                                key={m}
                                className={cn(
                                  "flex items-center justify-between py-1 px-2 rounded bg-muted/50",
                                  memberBusy && "opacity-70",
                                )}
                              >
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <User className="h-3 w-3 text-muted-foreground shrink-0" />
                                  <code className="text-xs font-mono truncate">{m}</code>
                                  {memberBusy && (
                                    <span className="text-[10px] text-muted-foreground shrink-0">Removing…</span>
                                  )}
                                </div>
                                <Button
                                  size="icon-sm"
                                  variant="ghost"
                                  disabled={!!removingMember}
                                  title="Remove from group"
                                  onClick={() => void handleRemoveUser(gName, m)}
                                >
                                  {memberBusy ? (
                                    <Loader2 className="h-2.5 w-2.5 animate-spin text-muted-foreground" />
                                  ) : (
                                    <Trash2 className="h-2.5 w-2.5 text-status-error" />
                                  )}
                                </Button>
                              </div>
                            )
                          })
                        )}
                      </div>
                    </div>

                    {/* Ranges */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-semibold text-muted-foreground uppercase">Ranges</p>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-xs"
                          onClick={() => {
                            setAddRangeSearch("")
                            setSelectedRangeIds(new Set())
                            setAddRangeDialog(gName)
                          }}
                        >
                          <Server className="h-3 w-3" />
                          Add
                        </Button>
                      </div>
                      <div className="space-y-1">
                        {detailLoading && detailRanges.length === 0 ? (
                          <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Loading ranges…
                          </div>
                        ) : detailRanges.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No ranges</p>
                        ) : (
                          detailRanges.map((r) => {
                            const rangeBusy = removingRange?.group === gName && removingRange?.rangeId === r
                            return (
                              <div
                                key={r}
                                className={cn(
                                  "flex items-center justify-between py-1 px-2 rounded bg-muted/50",
                                  rangeBusy && "opacity-70",
                                )}
                              >
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <Server className="h-3 w-3 text-muted-foreground shrink-0" />
                                  <code className="text-xs font-mono truncate">{r}</code>
                                  {rangeBusy && (
                                    <span className="text-[10px] text-muted-foreground shrink-0">Removing…</span>
                                  )}
                                </div>
                                <Button
                                  size="icon-sm"
                                  variant="ghost"
                                  disabled={!!removingRange}
                                  title="Remove range from group"
                                  onClick={() => setRemoveRangeFromGroupDialog({ group: gName, rangeId: r })}
                                >
                                  {rangeBusy ? (
                                    <Loader2 className="h-2.5 w-2.5 animate-spin text-muted-foreground" />
                                  ) : (
                                    <Trash2 className="h-2.5 w-2.5 text-status-error" />
                                  )}
                                </Button>
                              </div>
                            )
                          })
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              )}
            </Card>
            )
          })}
        </div>
      )}

      {/* Remove range from group — Ludus may require range router VM powered on */}
      <Dialog
        open={!!rrDlg}
        onOpenChange={(open) => {
          if (!open) {
            setRemoveRangeFromGroupDialog(null)
            setPoweringOnRouterForGroupRemove(false)
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Remove range from group</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1 text-sm">
            {rrDlg && (
              <p className="text-muted-foreground">
                Remove <code className="text-xs font-mono text-foreground">{rrDlg.rangeId}</code> from group{" "}
                <span className="font-medium text-foreground">{rrDlg.group}</span>? Members lose access via this
                group.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Ludus only completes this operation when the range&apos;s router VM is running. If it is off, power it
              on below and wait until status shows running — then remove.
            </p>

            {rrStatusPending && (
              <div className="flex items-center gap-2 text-muted-foreground py-2">
                <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                Loading range status…
              </div>
            )}

            {rrStatusError && (
              <Alert variant="destructive">
                <AlertDescription className="text-xs">
                  Could not load this range (permission or network). Fix access or try again; removal stays disabled
                  until status loads.
                </AlertDescription>
              </Alert>
            )}

            {!rrStatusPending && !rrStatusError && rrRangeData && (
              <>
                {rrRouter && !rrRouterOn && (
                  <Alert variant="warning">
                    <AlertDescription className="text-xs space-y-2">
                      <p>
                        Router VM is <strong>off</strong>. Power it on before removing this range from the group.
                      </p>
                      {rrRouterLabel ? (
                        <p className="font-mono text-[11px] break-all opacity-90">{rrRouterLabel}</p>
                      ) : null}
                      {rrStatusFetching && (
                        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Rechecking power state…
                        </p>
                      )}
                    </AlertDescription>
                  </Alert>
                )}
                {!rrRouter && (rrRangeData.VMs?.length ?? 0) > 0 && (
                  <Alert>
                    <AlertDescription className="text-xs">
                      No VM matching the Ludus router pattern (<code className="font-mono">*-router-debian*</code>) was
                      found. You may still try remove; if Ludus errors, deploy or verify the range first.
                    </AlertDescription>
                  </Alert>
                )}
                {rrRouter && rrRouterOn && (
                  <Alert variant="success">
                    <AlertDescription className="text-xs">
                      Router VM is running. You can remove this range from the group.
                      {rrStatusFetching ? (
                        <span className="inline-flex items-center gap-1 ml-2">
                          <Loader2 className="h-3 w-3 animate-spin" />
                        </span>
                      ) : null}
                    </AlertDescription>
                  </Alert>
                )}
              </>
            )}
          </div>
          <DialogFooter className="gap-2 flex-col sm:flex-row sm:justify-end">
            <div className="flex flex-wrap gap-2 w-full sm:w-auto sm:mr-auto">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={
                  !rrDlg ||
                  !rrRouter ||
                  rrRouterOn ||
                  rrStatusPending ||
                  rrStatusError ||
                  poweringOnRouterForGroupRemove ||
                  removingRange != null
                }
                onClick={() => void handlePowerOnRouterForGroupRemove()}
              >
                {poweringOnRouterForGroupRemove ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Power className="h-3.5 w-3.5" />
                )}
                Power on router
              </Button>
            </div>
            <div className="flex gap-2 w-full sm:w-auto justify-end">
              <Button type="button" variant="ghost" onClick={() => setRemoveRangeFromGroupDialog(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={!rrRemoveEnabled}
                className="gap-2"
                onClick={() => void executeRemoveRangeFromGroup()}
              >
                {removingRange &&
                rrDlg &&
                removingRange.group === rrDlg.group &&
                removingRange.rangeId === rrDlg.rangeId ? (
                  <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                ) : null}
                Remove from group
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Group Dialog */}
      <Dialog open={createDialog} onOpenChange={setCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Group</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Group Name</Label>
              <Input
                placeholder="red-team"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateDialog(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={creating || !newGroupName.trim()}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add User/Range Dialogs */}
      <Dialog
        open={!!addUserDialog}
        onOpenChange={(open) => {
          if (!open) setAddUserDialog(null)
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Users to {addUserDialog}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Search users</Label>
              <Input
                placeholder="Filter by ID or name…"
                value={addUserSearch}
                onChange={(e) => setAddUserSearch(e.target.value)}
              />
            </div>
            <ScrollArea className="h-[240px] rounded-md border border-border p-2">
              {loadingPickerUsers || loadingAddUserDetail ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : filteredPickerUsers.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">No users to add</p>
              ) : (
                <ul className="space-y-1">
                  {filteredPickerUsers.map((u) => (
                    <li key={u.userID}>
                      <label className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted/50 cursor-pointer">
                        <Checkbox
                          checked={selectedUserIds.has(u.userID)}
                          onCheckedChange={() => toggleUserPicker(u.userID)}
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
            <p className="text-xs text-muted-foreground">{selectedUserIds.size} selected</p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddUserDialog(null)}>Cancel</Button>
            <Button onClick={() => void handleAddUser()} disabled={addingUsers || selectedUserIds.size === 0}>
              {addingUsers ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Add Users
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!addRangeDialog}
        onOpenChange={(open) => {
          if (!open) {
            setAddRangeDialog(null)
            setPoweringOnRouterForGroupAddRangeId(null)
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Ranges to {addRangeDialog}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-xs text-muted-foreground">
              Ludus only completes this when each range&apos;s router VM is running. If a row shows the router off, use{" "}
              <strong>Power on router</strong> and wait until it shows running — then you can add checked ranges to the
              group.
            </p>
            <div className="space-y-1.5">
              <Label>Search ranges</Label>
              <Input
                placeholder="Filter by range ID or name…"
                value={addRangeSearch}
                onChange={(e) => setAddRangeSearch(e.target.value)}
              />
            </div>
            <ScrollArea className="h-[280px] rounded-md border border-border p-2">
              {loadingPickerRanges || loadingAddRangeDetail ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : filteredPickerRanges.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">No ranges to add</p>
              ) : (
                <ul className="space-y-1">
                  {filteredPickerRanges.map((r) => {
                    const st = addRangeStatusById.get(r.rangeID)
                    const rangeData = st?.data as RangeObject | undefined
                    const router = findLudusRangeRouterVm(rangeData?.VMs ?? [])
                    const routerOn = router ? isLudusVmRunning(router) : true
                    const routerLabel = router ? (router.name || router.vmName || "").trim() : ""
                    const pending = st?.isPending
                    const err = st?.isError
                    const fetching = st?.isFetching
                    const powerBusy = poweringOnRouterForGroupAddRangeId === r.rangeID
                    const powerDisabled =
                      !router ||
                      routerOn ||
                      pending ||
                      err ||
                      powerBusy ||
                      addingRanges
                    return (
                      <li
                        key={r.rangeID}
                        className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted/50 min-w-0"
                      >
                        <Checkbox
                          checked={selectedRangeIds.has(r.rangeID)}
                          onCheckedChange={() => toggleRangePicker(r.rangeID)}
                          className="shrink-0"
                        />
                        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-mono text-xs shrink-0">{r.rangeID}</span>
                            {r.name ? (
                              <span className="text-xs text-muted-foreground truncate">{r.name}</span>
                            ) : null}
                          </div>
                          {pending ? (
                            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                              <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                              Loading range status…
                            </span>
                          ) : err ? (
                            <span className="text-[10px] text-destructive">Could not load status for this range.</span>
                          ) : router && !routerOn ? (
                            <span className="text-[10px] text-yellow-600 dark:text-status-warning/90">
                              Router off{routerLabel ? ` — ${routerLabel}` : ""}
                              {fetching ? (
                                <span className="inline-flex items-center gap-1 ml-1">
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                </span>
                              ) : null}
                            </span>
                          ) : router && routerOn ? (
                            <span className="text-[10px] text-green-600 dark:text-status-success/90">
                              Router running
                              {fetching ? (
                                <span className="inline-flex items-center gap-1 ml-1">
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                </span>
                              ) : null}
                            </span>
                          ) : rangeData && (rangeData.VMs?.length ?? 0) > 0 ? (
                            <span className="text-[10px] text-muted-foreground">
                              No router VM matched (<code className="font-mono text-[9px]">*-router-debian*</code>).
                              You can still try add.
                            </span>
                          ) : null}
                        </div>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="outline"
                          className="shrink-0"
                          title="Power on this range’s router VM (needed for group membership changes)"
                          disabled={powerDisabled}
                          onClick={() => void handlePowerOnRouterForGroupAdd(r.rangeID, rangeData)}
                        >
                          {powerBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
                        </Button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </ScrollArea>
            <p className="text-xs text-muted-foreground">{selectedRangeIds.size} selected</p>
            {selectedRangesHiddenByFilter.length > 0 ? (
              <p className="text-xs text-amber-700 dark:text-amber-300/90">
                {selectedRangesHiddenByFilter.length} checked range(s) aren&apos;t in the list (search filter). Clear or
                widen search to use <strong>Power on router</strong> for those IDs.
              </p>
            ) : null}
            {selectedRangeIds.size > 0 && !addRangesSubmitEnabled && !addingRanges ? (
              <Alert variant="warning">
                <AlertDescription className="text-xs">
                  <strong>Add Ranges</strong> stays off until every checked range has loaded status and its router VM is
                  running (or Ludus has no matching router VM to check).
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setPoweringOnRouterForGroupAddRangeId(null)
                setAddRangeDialog(null)
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void handleAddRange()}
              disabled={addingRanges || selectedRangeIds.size === 0 || !addRangesSubmitEnabled}
            >
              {addingRanges ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Add Ranges
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
