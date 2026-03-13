"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { ludusApi, post } from "@/lib/api"
import type { GroupObject } from "@/lib/types"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

export default function GroupsPage() {
  const { toast } = useToast()
  const [groups, setGroups] = useState<GroupObject[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [createDialog, setCreateDialog] = useState(false)
  const [newGroupName, setNewGroupName] = useState("")
  const [creating, setCreating] = useState(false)
  const [addUserDialog, setAddUserDialog] = useState<string | null>(null)
  const [addRangeDialog, setAddRangeDialog] = useState<string | null>(null)
  const [addInput, setAddInput] = useState("")

  const fetchGroups = useCallback(async () => {
    setLoading(true)
    const result = await ludusApi.listGroups()
    if (result.data) setGroups(result.data)
    setLoading(false)
  }, [])

  useEffect(() => { fetchGroups() }, [fetchGroups])

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
      fetchGroups()
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
      fetchGroups()
    }
  }

  const handleAddUser = async () => {
    if (!addUserDialog || !addInput.trim()) return
    const userIds = addInput.split(",").map((s) => s.trim()).filter(Boolean)
    const result = await ludusApi.addUsersToGroup(addUserDialog, userIds)
    if (result.error) {
      toast({ variant: "destructive", title: "Error", description: result.error })
    } else {
      toast({ title: "Users added" })
      setAddUserDialog(null)
      setAddInput("")
      fetchGroups()
    }
  }

  const handleAddRange = async () => {
    if (!addRangeDialog || !addInput.trim()) return
    const rangeIds = addInput.split(",").map((s) => s.trim()).filter(Boolean)
    const result = await post(`/groups/${addRangeDialog}/ranges`, { rangeIDs: rangeIds })
    if (result.error) {
      toast({ variant: "destructive", title: "Error", description: result.error })
    } else {
      toast({ title: "Ranges added" })
      setAddRangeDialog(null)
      setAddInput("")
      fetchGroups()
    }
  }

  const handleRemoveUser = async (groupName: string, userId: string) => {
    const result = await ludusApi.removeUsersFromGroup(groupName, [userId])
    if (result.error) {
      toast({ variant: "destructive", title: "Error", description: result.error })
    } else {
      toast({ title: "User removed" })
      fetchGroups()
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
          <Button variant="ghost" size="icon" onClick={fetchGroups} disabled={loading}>
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
            const gName = group.groupName || group.name || group.id || "unknown"
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
                        {group.members?.length || 0} member(s)
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {group.ranges?.length || 0} range(s)
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
                            setAddInput("")
                            setAddUserDialog(gName)
                          }}
                        >
                          <UserPlus className="h-3 w-3" />
                          Add
                        </Button>
                      </div>
                      <div className="space-y-1">
                        {(group.members?.length ?? 0) === 0 ? (
                          <p className="text-xs text-muted-foreground">No members</p>
                        ) : (
                          group.members?.map((m) => (
                            <div key={m} className="flex items-center justify-between py-1 px-2 rounded bg-muted/50">
                              <div className="flex items-center gap-1.5">
                                <User className="h-3 w-3 text-muted-foreground" />
                                <code className="text-xs font-mono">{m}</code>
                              </div>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                onClick={() => handleRemoveUser(gName, m)}
                              >
                                <Trash2 className="h-2.5 w-2.5 text-red-400" />
                              </Button>
                            </div>
                          ))
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
                            setAddInput("")
                            setAddRangeDialog(gName)
                          }}
                        >
                          <Server className="h-3 w-3" />
                          Add
                        </Button>
                      </div>
                      <div className="space-y-1">
                        {(group.ranges?.length ?? 0) === 0 ? (
                          <p className="text-xs text-muted-foreground">No ranges</p>
                        ) : (
                          group.ranges?.map((r) => (
                            <div key={r} className="flex items-center gap-1.5 py-1 px-2 rounded bg-muted/50">
                              <Server className="h-3 w-3 text-muted-foreground" />
                              <code className="text-xs font-mono">{r}</code>
                            </div>
                          ))
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
      <Dialog open={!!addUserDialog} onOpenChange={() => setAddUserDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Users to {addUserDialog}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>User IDs (comma-separated)</Label>
              <Input
                placeholder="JD, AS, BW"
                value={addInput}
                onChange={(e) => setAddInput(e.target.value)}
                className="font-mono"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddUserDialog(null)}>Cancel</Button>
            <Button onClick={handleAddUser} disabled={!addInput.trim()}>Add Users</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!addRangeDialog} onOpenChange={() => setAddRangeDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Ranges to {addRangeDialog}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Range IDs (comma-separated)</Label>
              <Input
                placeholder="JD, AS"
                value={addInput}
                onChange={(e) => setAddInput(e.target.value)}
                className="font-mono"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddRangeDialog(null)}>Cancel</Button>
            <Button onClick={handleAddRange} disabled={!addInput.trim()}>Add Ranges</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
