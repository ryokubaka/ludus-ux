"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { STALE } from "@/lib/query-client"
import { useEffectiveScopeTag } from "@/lib/effective-scope-context"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  GitBranch,
  Plus,
  RefreshCw,
  Loader2,
  Trash2,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  BookTemplate,
  Package,
  ExternalLink,
  Zap,
  BookOpen,
  type LucideIcon,
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { cn, extractArray } from "@/lib/utils"
import { LUDUS_SOURCES_DOCS_URL } from "@/components/sources/source-catalog-banner"
import {
  fetchSourceCatalog,
  sourceCatalogItems,
} from "@/lib/source-catalog-client"
import { sourceBlueprintInstallId } from "@/lib/registered-ludus-sources"
import { ludusApi } from "@/lib/api"
import type { BlueprintListItem, TemplateObject } from "@/lib/types"
import {
  buildCatalogTemplatePresenceMap,
  getCatalogTemplatePresence,
} from "@/lib/template-install-match"
import {
  buildInstalledAnsibleNames,
  buildInstalledBlueprintIds,
  isSourceCatalogAnsibleInstalled,
  isSourceCatalogBlueprintInstalled,
} from "@/lib/source-catalog-presence"

interface LudusSource {
  id?: string
  sourceID?: string
  name?: string
  description?: string
  url?: string
  ref?: string
  lastSyncedAt?: string
  lastSyncStatus?: string
  lastSyncError?: string
}

interface SourceBlueprint {
  id?: string
  sourceBlueprintID?: string
  name?: string
  description?: string
  version?: string
  min_ludus_version?: string
}

interface SourceTemplate {
  name?: string
  version?: string
}

interface SourceRole {
  name?: string
  version?: string
  scope?: string
  state?: string
  fqcn?: string
}

interface SourceCollection {
  name?: string
  version?: string
  scope?: string
  state?: string
  fqcn?: string
}

function sourceId(row: LudusSource): string {
  return row.sourceID || row.id || ""
}

function CatalogSectionHeader({
  icon: Icon,
  title,
  count,
  loading,
  href,
  manageLabel,
}: {
  icon: LucideIcon
  title: string
  count: number
  loading: boolean
  href: string
  manageLabel: string
}) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <p className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5" /> {title}
        {!loading && <Badge variant="secondary" className="text-[10px]">{count}</Badge>}
      </p>
      <Link
        href={href}
        className="ml-auto inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
      >
        {manageLabel}
        <ExternalLink className="h-3 w-3" />
      </Link>
    </div>
  )
}

function SourceDetailPanel({ source }: { source: LudusSource }) {
  const scopeTag = useEffectiveScopeTag()
  const sid = sourceId(source)

  const { data: blueprintPayload, isLoading: bpLoading } = useQuery({
    queryKey: queryKeys.sourceBlueprints(scopeTag, sid),
    queryFn: async () => {
      const res = await fetch(`/api/sources/${encodeURIComponent(sid)}/blueprints`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      return {
        items: (data.blueprints ?? []) as SourceBlueprint[],
        catalogSource: data.catalogSource as string | undefined,
      }
    },
    staleTime: STALE.long,
  })

  const { data: templatePayload, isLoading: tplLoading } = useQuery({
    queryKey: queryKeys.sourceTemplates(scopeTag, sid),
    queryFn: async () => {
      const res = await fetch(`/api/sources/${encodeURIComponent(sid)}/templates`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      return {
        items: (data.templates ?? []) as SourceTemplate[],
        catalogSource: data.catalogSource as string | undefined,
      }
    },
    staleTime: STALE.long,
  })

  const { data: rolePayload, isLoading: roleLoading } = useQuery({
    queryKey: queryKeys.sourceRoles(scopeTag, sid),
    queryFn: async () => {
      const res = await fetch(`/api/sources/${encodeURIComponent(sid)}/roles`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      return {
        items: (data.roles ?? []) as SourceRole[],
        catalogSource: data.catalogSource as string | undefined,
      }
    },
    staleTime: STALE.long,
  })

  const { data: collectionPayload, isLoading: collLoading } = useQuery({
    queryKey: queryKeys.sourceCollections(scopeTag, sid),
    queryFn: async () => {
      const res = await fetch(`/api/sources/${encodeURIComponent(sid)}/collections`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      return {
        items: (data.collections ?? []) as SourceCollection[],
        catalogSource: data.catalogSource as string | undefined,
      }
    },
    staleTime: STALE.long,
  })

  const { data: ludusTemplates = [] } = useQuery({
    queryKey: queryKeys.templates(scopeTag),
    queryFn: async () => {
      const result = await ludusApi.listTemplates()
      return extractArray<TemplateObject>(result.data as unknown)
    },
    staleTime: STALE.long,
  })

  const { data: ludusBlueprints = [] } = useQuery({
    queryKey: queryKeys.blueprints(scopeTag),
    queryFn: async () => {
      const result = await ludusApi.listBlueprints()
      return extractArray<BlueprintListItem>(result.data as unknown)
    },
    staleTime: STALE.long,
  })

  const { data: ansibleData } = useQuery({
    queryKey: queryKeys.ansible(scopeTag),
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

  const templatePresence = useMemo(
    () => buildCatalogTemplatePresenceMap(ludusTemplates),
    [ludusTemplates],
  )

  const installedBlueprintIds = useMemo(
    () => buildInstalledBlueprintIds(ludusBlueprints),
    [ludusBlueprints],
  )

  const installedAnsibleNames = useMemo(
    () => buildInstalledAnsibleNames(ansibleData?.roles ?? [], ansibleData?.collections ?? []),
    [ansibleData],
  )

  const blueprints = blueprintPayload?.items ?? []
  const templates = templatePayload?.items ?? []
  const roles = rolePayload?.items ?? []
  const collections = collectionPayload?.items ?? []
  const catalogFromGit = [blueprintPayload, templatePayload, rolePayload, collectionPayload].some(
    (p) => p?.catalogSource === "github",
  )

  return (
    <div className="mt-3 space-y-4 border-t border-border pt-3">
      {catalogFromGit && (
        <p className="text-xs text-muted-foreground rounded border border-border bg-muted/30 px-3 py-2">
          Catalog listed from the Git repository tree — Ludus sync cache returned no items for some
          categories. Install from the{" "}
          <Link href="/blueprints" className="text-primary underline underline-offset-2">
            Blueprints
          </Link>
          ,{" "}
          <Link href="/templates" className="text-primary underline underline-offset-2">
            Templates
          </Link>
          , and{" "}
          <Link href="/ansible" className="text-primary underline underline-offset-2">
            Ansible
          </Link>{" "}
          pages.
        </p>
      )}
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <CatalogSectionHeader
            icon={Package}
            title="Blueprints"
            count={blueprints.length}
            loading={bpLoading}
            href="/blueprints"
            manageLabel="Manage blueprints"
          />
          {bpLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : blueprints.length === 0 ? (
            <p className="text-xs text-muted-foreground">No blueprints synced yet — try Sync above.</p>
          ) : (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {[...blueprints]
                .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
                .map((bp) => {
                  const name = bp.name || bp.sourceBlueprintID || ""
                  const key = sourceBlueprintInstallId(bp, sid)
                  const installed = isSourceCatalogBlueprintInstalled(bp, sid, installedBlueprintIds)
                  return (
                    <div
                      key={key}
                      className="flex items-start gap-2 rounded px-2 py-1.5 hover:bg-muted/50"
                    >
                      <div className="min-w-0 flex-1">
                        <code className="text-xs font-mono text-primary">{name}</code>
                        {bp.description && (
                          <p className="text-[10px] text-muted-foreground line-clamp-2">{bp.description}</p>
                        )}
                        {bp.min_ludus_version && (
                          <Badge variant="outline" className="text-[10px] mt-0.5">
                            Ludus {bp.min_ludus_version}+
                          </Badge>
                        )}
                      </div>
                      <Badge
                        variant={installed ? "success" : "outline"}
                        className="text-[10px] shrink-0"
                      >
                        {installed ? "Installed" : "Not installed"}
                      </Badge>
                    </div>
                  )
                })}
            </div>
          )}
        </div>
        <div>
          <CatalogSectionHeader
            icon={BookTemplate}
            title="Templates"
            count={templates.length}
            loading={tplLoading}
            href="/templates"
            manageLabel="Manage templates"
          />
          {tplLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : templates.length === 0 ? (
            <p className="text-xs text-muted-foreground">No templates synced yet — try Sync above.</p>
          ) : (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {[...templates]
                .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
                .map((tpl) => {
                  const name = tpl.name || ""
                  const presence = getCatalogTemplatePresence(name, templatePresence)
                  return (
                    <div
                      key={name}
                      className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted/50"
                    >
                      <code className="text-xs font-mono text-primary truncate">{name}</code>
                      {tpl.version && (
                        <span className="text-[10px] text-muted-foreground shrink-0">{tpl.version}</span>
                      )}
                      {presence === "built" ? (
                        <Badge variant="success" className="text-[10px] ml-auto shrink-0">Built</Badge>
                      ) : presence === "added" ? (
                        <Badge variant="warning" className="text-[10px] ml-auto shrink-0">Added</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] ml-auto shrink-0">Not added</Badge>
                      )}
                    </div>
                  )
                })}
            </div>
          )}
        </div>
        <div>
          <CatalogSectionHeader
            icon={Zap}
            title="Ansible Roles"
            count={roles.length}
            loading={roleLoading}
            href="/ansible"
            manageLabel="Manage ansible"
          />
          {roleLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : roles.length === 0 ? (
            <p className="text-xs text-muted-foreground">No roles in this source catalog.</p>
          ) : (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {[...roles]
                .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
                .map((role) => {
                  const name = role.name || ""
                  const installed = isSourceCatalogAnsibleInstalled(role, installedAnsibleNames)
                  return (
                    <div
                      key={name}
                      className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted/50"
                    >
                      <code className="text-xs font-mono text-primary truncate">{name}</code>
                      {role.scope && (
                        <Badge variant="outline" className="text-[10px] capitalize shrink-0">
                          {role.scope}
                        </Badge>
                      )}
                      <Badge
                        variant={installed ? "success" : "outline"}
                        className="text-[10px] ml-auto shrink-0"
                      >
                        {installed ? "Installed" : "Not installed"}
                      </Badge>
                    </div>
                  )
                })}
            </div>
          )}
        </div>
        <div>
          <CatalogSectionHeader
            icon={BookOpen}
            title="Ansible Collections"
            count={collections.length}
            loading={collLoading}
            href="/ansible"
            manageLabel="Manage ansible"
          />
          {collLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : collections.length === 0 ? (
            <p className="text-xs text-muted-foreground">No collections in this source catalog.</p>
          ) : (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {[...collections]
                .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
                .map((coll) => {
                  const name = coll.name || ""
                  const installed = isSourceCatalogAnsibleInstalled(coll, installedAnsibleNames)
                  return (
                    <div
                      key={name}
                      className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted/50"
                    >
                      <code className="text-xs font-mono text-primary truncate">{name}</code>
                      {coll.scope && (
                        <Badge variant="outline" className="text-[10px] capitalize shrink-0">
                          {coll.scope}
                        </Badge>
                      )}
                      <Badge
                        variant={installed ? "success" : "outline"}
                        className="text-[10px] ml-auto shrink-0"
                      >
                        {installed ? "Installed" : "Not installed"}
                      </Badge>
                    </div>
                  )
                })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function SourcesPageClient() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const scopeTag = useEffectiveScopeTag()
  const [addOpen, setAddOpen] = useState(false)
  const [newUrl, setNewUrl] = useState("https://github.com/badsectorlabs/ludus-source-bsl")
  const [newRef, setNewRef] = useState("main")
  const [adding, setAdding] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<LudusSource | null>(null)
  const [purgeOnDelete, setPurgeOnDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [syncingId, setSyncingId] = useState<string | null>(null)

  const { data, isLoading, refetch } = useQuery({
    queryKey: queryKeys.sources(scopeTag),
    queryFn: async () => {
      const res = await fetch("/api/sources")
      const json = await res.json()
      if (!res.ok && res.status !== 404) throw new Error(json.error || `HTTP ${res.status}`)
      return {
        sources: (json.sources ?? []) as LudusSource[],
        available: json.available !== false && res.ok,
      }
    },
    staleTime: STALE.long,
  })

  const sources = data?.sources ?? []
  const sourcesAvailable = data?.available ?? false

  const invalidateSources = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.sources(scopeTag) })

  const handleRegister = async () => {
    if (!newUrl.trim()) return
    setAdding(true)
    try {
      const res = await fetch("/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: newUrl.trim(), ref: newRef.trim() || "main" }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      toast({ title: "Source registered", description: json.sourceID || newUrl })
      setAddOpen(false)
      invalidateSources()
    } catch (err) {
      toast({ variant: "destructive", title: "Registration failed", description: (err as Error).message })
    } finally {
      setAdding(false)
    }
  }

  const handleSync = async (source: LudusSource) => {
    const sid = sourceId(source)
    setSyncingId(sid)
    try {
      const res = await fetch(`/api/sources/${encodeURIComponent(sid)}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true, globalRoles: true }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      toast({ title: "Source synced", description: source.name || sid })
      invalidateSources()
      queryClient.invalidateQueries({ queryKey: queryKeys.sourceBlueprints(scopeTag, sid) })
      queryClient.invalidateQueries({ queryKey: queryKeys.sourceTemplates(scopeTag, sid) })
      queryClient.invalidateQueries({ queryKey: queryKeys.sourceRoles(scopeTag, sid) })
      queryClient.invalidateQueries({ queryKey: queryKeys.sourceCollections(scopeTag, sid) })
    } catch (err) {
      toast({ variant: "destructive", title: "Sync failed", description: (err as Error).message })
    } finally {
      setSyncingId(null)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    const sid = sourceId(deleteTarget)
    setDeleting(true)
    try {
      const res = await fetch(`/api/sources/${encodeURIComponent(sid)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purge: purgeOnDelete }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      toast({ title: "Source deleted" })
      setDeleteTarget(null)
      setPurgeOnDelete(false)
      if (expanded === sid) setExpanded(null)
      invalidateSources()
    } catch (err) {
      toast({ variant: "destructive", title: "Delete failed", description: (err as Error).message })
    } finally {
      setDeleting(false)
    }
  }

  if (!sourcesAvailable && !isLoading) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center py-12 text-center gap-3">
          <AlertTriangle className="h-10 w-10 text-muted-foreground/50" />
          <p className="text-sm font-medium">Sources require Ludus 2.2.0 or newer</p>
          <p className="text-xs text-muted-foreground max-w-md">
            Upgrade your Ludus server to register git sources and browse blueprints, templates, and bundled Ansible
            content from a shared catalog. Blueprint and template &quot;Add from Source&quot; panels still work via GitHub on older Ludus.
          </p>
          <a
            href={LUDUS_SOURCES_DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline inline-flex items-center gap-1"
          >
            Ludus Sources documentation
            <ExternalLink className="h-3 w-3" />
          </a>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground">
          Register git repositories as Ludus Sources to sync blueprints, templates, and bundled Ansible content.{" "}
          <a
            href={LUDUS_SOURCES_DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline inline-flex items-center gap-0.5"
          >
            Documentation
            <ExternalLink className="h-3 w-3" />
          </a>
        </p>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
          </Button>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" />
            Register Source
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : sources.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <GitBranch className="h-8 w-8 opacity-40" />
            <p>No sources registered yet</p>
            <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
              Register your first source
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {sources.map((source) => {
            const sid = sourceId(source)
            const isExpanded = expanded === sid
            return (
              <Card key={sid}>
                <CardHeader className="p-0">
                  <div className="flex items-center justify-between gap-3 px-4 py-3">
                    <button
                      type="button"
                      className="flex items-center gap-2 text-left min-w-0 flex-1"
                      onClick={() => setExpanded(isExpanded ? null : sid)}
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <div className="min-w-0">
                        <CardTitle className="text-sm font-semibold leading-tight">
                          {source.name || sid}
                        </CardTitle>
                        {source.url && (
                          <p className="text-xs text-muted-foreground truncate">{source.url}</p>
                        )}
                        <div className="flex flex-wrap items-center gap-2 mt-1">
                          {source.ref && (
                            <Badge variant="secondary" className="text-[10px]">{source.ref}</Badge>
                          )}
                          {source.lastSyncStatus && (
                            <Badge
                              variant={source.lastSyncStatus === "ok" ? "success" : "warning"}
                              className="text-[10px]"
                            >
                              sync: {source.lastSyncStatus}
                            </Badge>
                          )}
                        </div>
                        {source.lastSyncError && (
                          <p className="text-[10px] text-status-error mt-1">{source.lastSyncError}</p>
                        )}
                      </div>
                    </button>
                    <div className="flex items-center gap-1 shrink-0 self-center">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSync(source)}
                        disabled={syncingId === sid}
                      >
                        {syncingId === sid ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                        Sync
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => {
                          setDeleteTarget(source)
                          setPurgeOnDelete(false)
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-status-error" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                {isExpanded && (
                  <CardContent className="pt-0">
                    <SourceDetailPanel source={source} />
                  </CardContent>
                )}
              </Card>
            )
          })}
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Register Git Source</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="source-url">Repository URL</Label>
              <Input
                id="source-url"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="https://github.com/org/ludus-source"
              />
            </div>
            <div>
              <Label htmlFor="source-ref">Ref (branch / tag)</Label>
              <Input
                id="source-ref"
                value={newRef}
                onChange={(e) => setNewRef(e.target.value)}
                placeholder="main"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleRegister} disabled={adding || !newUrl.trim()}>
              {adding && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Register
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete source</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Remove <code className="text-primary">{deleteTarget ? sourceId(deleteTarget) : ""}</code> from Ludus?
          </p>
          <label className="flex items-start gap-2 cursor-pointer">
            <Checkbox checked={purgeOnDelete} onCheckedChange={(v) => setPurgeOnDelete(v === true)} />
            <span className="text-xs text-muted-foreground">
              Purge — also remove templates and local roles registered by this source. Galaxy collections declared by
              the source are not removed from disk (Ludus limitation).
            </span>
          </label>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
