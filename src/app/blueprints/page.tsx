"use client"

import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { STALE } from "@/lib/query-client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
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
  CheckCircle2,
} from "lucide-react"
import { ludusApi } from "@/lib/api"
import type { BlueprintListItem } from "@/lib/types"
import { useToast } from "@/hooks/use-toast"
import { cn, formatDate } from "@/lib/utils"

export default function BlueprintsPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [createDialog, setCreateDialog] = useState(false)
  const [viewDialog, setViewDialog] = useState<{ id: string; yaml: string } | null>(null)
  const [shareDialog, setShareDialog] = useState<string | null>(null)
  const [newBpId, setNewBpId] = useState("")
  const [newBpName, setNewBpName] = useState("")
  const [newBpDesc, setNewBpDesc] = useState("")
  const [creating, setCreating] = useState(false)
  const [shareUsers, setShareUsers] = useState("")
  const [shareGroups, setShareGroups] = useState("")

  const { data: blueprints = [], isLoading: loading } = useQuery({
    queryKey: queryKeys.blueprints(),
    queryFn: async () => {
      const result = await ludusApi.listBlueprints()
      return result.data ?? []
    },
    staleTime: STALE.medium,
  })

  const invalidateBlueprints = () => queryClient.invalidateQueries({ queryKey: queryKeys.blueprints() })

  const handleCreate = async () => {
    if (!newBpId.trim()) {
      toast({ variant: "destructive", title: "Blueprint ID required" })
      return
    }
    setCreating(true)
    const result = await ludusApi.createBlueprintFromRange(newBpId.trim())
    if (result.error) {
      toast({ variant: "destructive", title: "Error", description: result.error })
    } else {
      toast({ title: "Blueprint created from current range config" })
      setCreateDialog(false)
      setNewBpId("")
      invalidateBlueprints()
    }
    setCreating(false)
  }

  const handleApply = async (id: string) => {
    if (!confirm(`Apply blueprint "${id}" to your current range? This will overwrite your range config.`)) return
    const result = await ludusApi.applyBlueprint(id)
    if (result.error) {
      toast({ variant: "destructive", title: "Error", description: result.error })
    } else {
      toast({ title: "Blueprint applied", description: "Don't forget to deploy your range" })
    }
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
    const users = shareUsers.split(",").map((s) => s.trim()).filter(Boolean)
    const groups = shareGroups.split(",").map((s) => s.trim()).filter(Boolean)

    let error: string | undefined
    if (users.length) {
      const r = await ludusApi.shareBlueprintWithUsers(shareDialog, users)
      if (r.error) error = r.error
    }
    if (!error && groups.length) {
      const r = await ludusApi.shareBlueprintWithGroups(shareDialog, groups)
      if (r.error) error = r.error
    }

    if (error) {
      toast({ variant: "destructive", title: "Error", description: error })
    } else {
      toast({ title: "Blueprint shared" })
      setShareDialog(null)
      setShareUsers("")
      setShareGroups("")
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
        <Button variant="ghost" size="icon" onClick={invalidateBlueprints} disabled={loading}>
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </Button>
      </div>

      {/* Blueprint list */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : blueprints.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-muted-foreground">
            <Package className="h-10 w-10 mb-3 opacity-40" />
            <p>No blueprints</p>
            <p className="text-xs mt-1">Create a blueprint from your current range config</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {blueprints.map((bp) => {
            const bpId = bp.id || bp.blueprintID || ""
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
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0 ml-4">
                    <Button size="icon-sm" variant="ghost" onClick={() => handleView(bpId)} title="View config">
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon-sm" variant="ghost" onClick={() => handleApply(bpId)} title="Apply to range">
                      <Play className="h-3.5 w-3.5 text-green-400" />
                    </Button>
                    <Button size="icon-sm" variant="ghost" onClick={() => handleCopy(bpId)} title="Copy blueprint">
                      <Copy className="h-3.5 w-3.5 text-blue-400" />
                    </Button>
                    {(!bp.access || bp.access === "owner" || bp.access === "admin") && (
                      <>
                        <Button size="icon-sm" variant="ghost" onClick={() => setShareDialog(bpId)} title="Share">
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
      <Dialog open={createDialog} onOpenChange={(open) => { setCreateDialog(open); if (!open) setNewBpId("") }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Blueprint from Range</DialogTitle>
            <DialogDescription>
              Save your current range configuration as a reusable blueprint.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="new-bp-id">Blueprint ID <span className="text-red-400">*</span></Label>
              <Input
                id="new-bp-id"
                placeholder="my-blueprint"
                value={newBpId}
                onChange={(e) => setNewBpId(e.target.value)}
                className="font-mono"
                onKeyDown={(e) => { if (e.key === "Enter") handleCreate() }}
              />
              <p className="text-xs text-muted-foreground">A unique identifier for this blueprint</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setCreateDialog(false); setNewBpId("") }}>Cancel</Button>
            <Button onClick={handleCreate} disabled={creating || !newBpId.trim()}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />}
              Create Blueprint
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
        <Dialog open={!!shareDialog} onOpenChange={() => setShareDialog(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Share Blueprint — {shareDialog}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>Share with Users (comma-separated IDs)</Label>
                <Input placeholder="JD, AS, BW" value={shareUsers} onChange={(e) => setShareUsers(e.target.value)} className="font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label>Share with Groups (comma-separated names)</Label>
                <Input placeholder="red-team, blue-team" value={shareGroups} onChange={(e) => setShareGroups(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setShareDialog(null)}>Cancel</Button>
              <Button onClick={handleShare} disabled={!shareUsers.trim() && !shareGroups.trim()}>
                <Share2 className="h-4 w-4" />
                Share
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
