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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Zap,
  Plus,
  Trash2,
  RefreshCw,
  Loader2,
  Package,
  BookOpen,
} from "lucide-react"
import { ludusApi } from "@/lib/api"
import type { AnsibleItem } from "@/lib/types"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

export default function AnsiblePage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [addRoleDialog, setAddRoleDialog] = useState(false)
  const [addCollDialog, setAddCollDialog] = useState(false)
  const [newRoleName, setNewRoleName] = useState("")
  const [newRoleVersion, setNewRoleVersion] = useState("")
  const [newCollName, setNewCollName] = useState("")
  const [newCollVersion, setNewCollVersion] = useState("")
  const [adding, setAdding] = useState(false)

  const { data: ansibleData, isLoading: loading } = useQuery({
    queryKey: queryKeys.ansible(),
    queryFn: async () => {
      const result = await ludusApi.listAnsible()
      const list = result.data ?? []
      return {
        roles: list.filter((i) => (i.type || i.Type) === "role"),
        collections: list.filter((i) => (i.type || i.Type) === "collection"),
      }
    },
    staleTime: STALE.long,
  })

  const roles = ansibleData?.roles ?? []
  const collections = ansibleData?.collections ?? []
  const invalidateAnsible = () => queryClient.invalidateQueries({ queryKey: queryKeys.ansible() })

  const handleAddRole = async () => {
    if (!newRoleName.trim()) return
    setAdding(true)
    const result = await ludusApi.addRole(newRoleName, newRoleVersion || undefined)
    if (result.error) {
      const alreadyInstalled =
        /already installed/i.test(result.error) ||
        /nothing to do/i.test(result.error)
      if (alreadyInstalled) {
        toast({ title: "Already installed", description: `${newRoleName} is already present on the server.` })
        setAddRoleDialog(false)
        setNewRoleName("")
        setNewRoleVersion("")
        invalidateAnsible()
      } else {
        toast({ variant: "destructive", title: "Error", description: result.error })
      }
    } else {
      toast({ title: "Role added", description: newRoleName })
      setAddRoleDialog(false)
      setNewRoleName("")
      setNewRoleVersion("")
      invalidateAnsible()
    }
    setAdding(false)
  }

  const handleRemoveRole = async (name: string) => {
    if (!confirm(`Remove role "${name}"?`)) return
    const result = await ludusApi.removeRole(name)
    if (result.error) {
      toast({ variant: "destructive", title: "Error", description: result.error })
    } else {
      toast({ title: "Role removed" })
      invalidateAnsible()
    }
  }

  const handleAddCollection = async () => {
    if (!newCollName.trim()) return
    setAdding(true)
    const result = await ludusApi.addCollection(newCollName, newCollVersion.trim() || undefined)
    if (result.status === 409 || (result.error && /already installed/i.test(result.error))) {
      toast({ title: "Already installed", description: `${newCollName} is already installed on the server.` })
      setAddCollDialog(false)
      setNewCollName("")
      setNewCollVersion("")
      invalidateAnsible()
    } else if (result.error) {
      const isPreRelease = /pre-release|pre_release|--pre/i.test(result.error)
      toast({
        variant: "destructive",
        title: "Error installing collection",
        description: isPreRelease
          ? `${newCollName} is only available as a pre-release. Specify a concrete version number (e.g. 0.1.0) in the Version field and try again.`
          : result.error,
      })
    } else {
      toast({ title: "Collection added", description: newCollName })
      setAddCollDialog(false)
      setNewCollName("")
      setNewCollVersion("")
      invalidateAnsible()
    }
    setAdding(false)
  }

  return (
    <div className="space-y-6">
      <Tabs defaultValue="roles">
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="roles">
              <Zap className="h-3.5 w-3.5 mr-1.5" />
              Roles ({roles.length})
            </TabsTrigger>
            <TabsTrigger value="collections">
              <Package className="h-3.5 w-3.5 mr-1.5" />
              Collections ({collections.length})
            </TabsTrigger>
          </TabsList>
          <Button variant="ghost" size="icon" onClick={invalidateAnsible} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </div>

        {/* Roles Tab */}
        <TabsContent value="roles" className="mt-4">
          <div className="flex justify-end mb-3">
            <Button onClick={() => setAddRoleDialog(true)}>
              <Plus className="h-4 w-4" />
              Add Role
            </Button>
          </div>

          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : roles.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center py-10 text-muted-foreground">
                <Zap className="h-8 w-8 mb-2 opacity-40" />
                <p>No roles installed</p>
                <p className="text-xs mt-1">Add roles from Ansible Galaxy to use in range-config.yml</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50 border-b border-border">
                        <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase">Role Name</th>
                        <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase">Version</th>
                        <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase">Source</th>
                        <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase">Scope</th>
                        <th className="p-3 text-right text-xs font-semibold text-muted-foreground uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {roles.map((role) => {
                        const rName = role.name || role.Name || ""
                        const rVersion = role.version || role.Version
                        const rGlobal = role.global ?? role.Global
                        return (
                        <tr key={rName} className="border-b border-border/50 last:border-0 hover:bg-muted/30">
                          <td className="p-3">
                            <code className="font-mono text-xs text-primary">{rName}</code>
                          </td>
                          <td className="p-3">
                            <code className="font-mono text-xs text-muted-foreground">{rVersion || "latest"}</code>
                          </td>
                          <td className="p-3">
                            <Badge variant="secondary" className="text-xs">galaxy</Badge>
                          </td>
                          <td className="p-3">
                            <Badge variant={rGlobal ? "cyan" : "secondary"} className="text-xs">
                              {rGlobal ? "global" : "user"}
                            </Badge>
                          </td>
                          <td className="p-3 text-right">
                            <Button size="icon-sm" variant="ghost" onClick={() => handleRemoveRole(rName)}>
                              <Trash2 className="h-3 w-3 text-red-400" />
                            </Button>
                          </td>
                        </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Collections Tab */}
        <TabsContent value="collections" className="mt-4">
          <div className="flex justify-end mb-3">
            <Button onClick={() => setAddCollDialog(true)}>
              <Plus className="h-4 w-4" />
              Add Collection
            </Button>
          </div>

          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : collections.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center py-10 text-muted-foreground">
                <Package className="h-8 w-8 mb-2 opacity-40" />
                <p>No collections installed</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50 border-b border-border">
                        <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase">Collection Name</th>
                        <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase">Version</th>
                      </tr>
                    </thead>
                    <tbody>
                      {collections.map((coll) => {
                        const cName = coll.name || coll.Name || ""
                        const cVersion = coll.version || coll.Version
                        return (
                        <tr key={cName} className="border-b border-border/50 last:border-0 hover:bg-muted/30">
                          <td className="p-3">
                            <code className="font-mono text-xs text-primary">{cName}</code>
                          </td>
                          <td className="p-3">
                            <code className="font-mono text-xs text-muted-foreground">{cVersion || "latest"}</code>
                          </td>
                        </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Add Role Dialog */}
      <Dialog open={addRoleDialog} onOpenChange={setAddRoleDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Ansible Role</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Role Name <span className="text-red-400">*</span></Label>
              <Input
                placeholder="badsectorlabs.ludus_vulhub or namespace.role_name"
                value={newRoleName}
                onChange={(e) => setNewRoleName(e.target.value)}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">From Ansible Galaxy (namespace.role_name format)</p>
            </div>
            <div className="space-y-1.5">
              <Label>Version (optional)</Label>
              <Input placeholder="latest or 1.2.3" value={newRoleVersion} onChange={(e) => setNewRoleVersion(e.target.value)} className="font-mono" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddRoleDialog(false)}>Cancel</Button>
            <Button onClick={handleAddRole} disabled={adding || !newRoleName.trim()}>
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add Role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Collection Dialog */}
      <Dialog open={addCollDialog} onOpenChange={(open) => { setAddCollDialog(open); if (!open) { setNewCollName(""); setNewCollVersion("") } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Ansible Collection</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Collection Name <span className="text-red-400">*</span></Label>
              <Input
                placeholder="community.general or namespace.collection"
                value={newCollName}
                onChange={(e) => setNewCollName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !adding && newCollName.trim() && handleAddCollection()}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">FQCN format: namespace.collection_name</p>
            </div>
            <div className="space-y-1.5">
              <Label>Version (optional)</Label>
              <Input
                placeholder="latest or 1.2.3"
                value={newCollVersion}
                onChange={(e) => setNewCollVersion(e.target.value)}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Required for pre-release collections — specify a version like <code className="text-primary">0.1.0</code>
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddCollDialog(false)}>Cancel</Button>
            <Button onClick={handleAddCollection} disabled={adding || !newCollName.trim()}>
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add Collection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
