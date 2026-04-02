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
} from "lucide-react"
import { ludusApi } from "@/lib/api"
import type { GroupObject, UserObject, RangeObject } from "@/lib/types"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { useRange } from "@/lib/range-context"

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

function bulkGroupErrors(data: unknown): { item: string; reason: string }[] {
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

/** Ludus may return `[]`, `{ result: [...] }`, `{ groups: [...] }`, `{ items: [...] }`, or a single row. */
function asGroupObjectArray(data: unknown): GroupObject[] {
  if (data == null) return []
  if (Array.isArray(data)) return data as GroupObject[]
  if (typeof data === "object" && data !== null) {
    if ("result" in data) {
      const inner = (data as { result: unknown }).result
      if (Array.isArray(inner)) return inner as GroupObject[]
      if (inner && typeof inner === "object") return [inner as GroupObject]
      return []
    }
    if ("groups" in data && Array.isArray((data as { groups: unknown }).groups)) {
      return (data as { groups: GroupObject[] }).groups
    }
    if ("items" in data && Array.isArray((data as { items: unknown }).items)) {
      return (data as { items: GroupObject[] }).items
    }
  }
  return []
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

export default function GroupsPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
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

  const { data: groupsRaw, isLoading: loading } = useQuery({
    queryKey: queryKeys.groups(),
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
      await queryClient.invalidateQueries({ queryKey: queryKeys.groups() })
      await queryClient.invalidateQueries({ queryKey: ["groups", "detail"], exact: false })
      if (opts?.refreshAccessibleRanges) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.accessibleRanges() })
        await refreshRanges()
      }
    },
    [queryClient, refreshRanges]
  )

  const { data: pickerUsers = [], isLoading: loadingPickerUsers } = useQuery({
    queryKey: queryKeys.users(),
    queryFn: async () => {
      const r = await ludusApi.listAllUsers().catch(() => ludusApi.listUsers())
      return asUserObjectArray(r.data)
    },
    enabled: !!addUserDialog,
    staleTime: STALE.long,
  })

  const { data: pickerRangesRaw, isLoading: loadingPickerRanges } = useQuery({
    queryKey: queryKeys.allRanges(),
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
    queryKey: queryKeys.groupDetail(addUserDialog || "_"),
    queryFn: () => fetchGroupDetail(addUserDialog!),
    enabled: !!addUserDialog,
    staleTime: STALE.short,
  })

  const { data: addRangeDialogDetail, isLoading: loadingAddRangeDetail } = useQuery({
    queryKey: queryKeys.groupDetail(addRangeDialog || "_"),
    queryFn: () => fetchGroupDetail(addRangeDialog!),
    enabled: !!addRangeDialog,
    staleTime: STALE.short,
  })

  const expandedSorted = useMemo(() => Array.from(expandedGroups).sort(), [expandedGroups])

  const expandedDetailQueries = useQueries({
    queries: expandedSorted.map((gName) => ({
      queryKey: queryKeys.groupDetail(gName),
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

  const handleRemoveRange = async (groupName: string, rangeId: string) => {
    if (!confirm(`Remove range "${rangeId}" from group "${groupName}"? Members will lose access via this group.`)) return
    setRemovingRange({ group: groupName, rangeId })
    try {
      const result = await ludusApi.removeRangesFromGroup(groupName, [rangeId])
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
        toast({ title: "Range removed from group", description: rangeId })
      }
      if (!result.error) await invalidateGroups({ refreshAccessibleRanges: true })
    } finally {
      setRemovingRange(null)
    }
  }

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
          <Button variant="ghost" size="icon" onClick={() => void invalidateGroups()} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
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
                    <Users2 className="h-4 w-4 text-blue-400" />
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
                    <Trash2 className="h-3.5 w-3.5 text-red-400" />
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
                                    <Trash2 className="h-2.5 w-2.5 text-red-400" />
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
                                  onClick={() => void handleRemoveRange(gName, r)}
                                >
                                  {rangeBusy ? (
                                    <Loader2 className="h-2.5 w-2.5 animate-spin text-muted-foreground" />
                                  ) : (
                                    <Trash2 className="h-2.5 w-2.5 text-red-400" />
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
          if (!open) setAddRangeDialog(null)
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Ranges to {addRangeDialog}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Search ranges</Label>
              <Input
                placeholder="Filter by range ID or name…"
                value={addRangeSearch}
                onChange={(e) => setAddRangeSearch(e.target.value)}
              />
            </div>
            <ScrollArea className="h-[240px] rounded-md border border-border p-2">
              {loadingPickerRanges || loadingAddRangeDetail ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : filteredPickerRanges.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">No ranges to add</p>
              ) : (
                <ul className="space-y-1">
                  {filteredPickerRanges.map((r) => (
                    <li key={r.rangeID}>
                      <label className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted/50 cursor-pointer">
                        <Checkbox
                          checked={selectedRangeIds.has(r.rangeID)}
                          onCheckedChange={() => toggleRangePicker(r.rangeID)}
                        />
                        <span className="font-mono text-xs">{r.rangeID}</span>
                        {r.name && (
                          <span className="text-xs text-muted-foreground truncate">{r.name}</span>
                        )}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>
            <p className="text-xs text-muted-foreground">{selectedRangeIds.size} selected</p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddRangeDialog(null)}>Cancel</Button>
            <Button onClick={() => void handleAddRange()} disabled={addingRanges || selectedRangeIds.size === 0}>
              {addingRanges ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Add Ranges
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
