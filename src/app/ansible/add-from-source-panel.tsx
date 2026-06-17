"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { STALE } from "@/lib/query-client"
import { useEffectiveScopeTag } from "@/lib/effective-scope-context"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ExpandableCardTrigger } from "@/components/ui/expandable-card-trigger"
import {
  mapRegisteredSources,
  pickDefaultRegisteredSource,
  registeredSourceLabel,
} from "@/lib/registered-ludus-sources"
import {
  fetchSourceCatalog,
  sourceCatalogItems,
} from "@/lib/source-catalog-client"
import { useToast } from "@/hooks/use-toast"
import { ludusApi } from "@/lib/api"
import {
  buildInstalledAnsibleNames,
  sourceCatalogAnsibleInstallState,
} from "@/lib/source-catalog-presence"
import { Download, GitBranch, ChevronDown, ChevronRight, Loader2, Package, Search, Zap } from "lucide-react"
import { groupGalaxySearchHits } from "@/lib/ansible-galaxy-search"

interface SourceRole {
  name?: string
  scope?: string
  state?: string
  fqcn?: string
}

interface SourceCollection {
  name?: string
  scope?: string
  state?: string
  fqcn?: string
}

interface GalaxyHit {
  name: string
  version?: string
  type: "role" | "collection"
  description?: string
}

export function AnsibleAddFromSourcePanel({ onChanged }: { onChanged: () => void }) {
  const { toast } = useToast()
  const scopeTag = useEffectiveScopeTag()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<"source" | "galaxy">("source")
  const [registeredSourceId, setRegisteredSourceId] = useState("")
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(new Set())
  const [selectedCollections, setSelectedCollections] = useState<Set<string>>(new Set())
  const [installing, setInstalling] = useState(false)
  const [galaxyType, setGalaxyType] = useState<"role" | "collection">("role")
  const [galaxyQuery, setGalaxyQuery] = useState("")
  const [galaxyHits, setGalaxyHits] = useState<GalaxyHit[]>([])
  const [galaxyLoading, setGalaxyLoading] = useState(false)
  const [addingGalaxy, setAddingGalaxy] = useState<string | null>(null)
  const [galaxySearched, setGalaxySearched] = useState(false)
  const [expandedGalaxyGroups, setExpandedGalaxyGroups] = useState<Set<string>>(new Set())

  const { data: ludusSourcesMeta } = useQuery({
    queryKey: queryKeys.sources(scopeTag),
    queryFn: async () => {
      const res = await fetch("/api/sources")
      const json = await res.json()
      return {
        available: json.available !== false && res.ok,
        sources: (json.sources ?? []) as Array<{ sourceID?: string; id?: string; name?: string; url?: string }>,
      }
    },
    enabled: open,
    staleTime: STALE.long,
  })

  const registeredSources = useMemo(
    () => mapRegisteredSources(ludusSourcesMeta?.sources ?? []),
    [ludusSourcesMeta],
  )

  useEffect(() => {
    if (!open || registeredSources.length === 0) return
    const def = pickDefaultRegisteredSource(registeredSources)
    if (def) setRegisteredSourceId((prev) => prev || def.id)
  }, [open, registeredSources])

  const sid = registeredSourceId

  const { data: rolePayload, isLoading: rolesLoading } = useQuery({
    queryKey: queryKeys.sourceRoles(scopeTag, sid),
    queryFn: () => fetchSourceCatalog<SourceRole>(sid, "roles"),
    enabled: open && tab === "source" && !!sid,
    staleTime: STALE.long,
  })

  const { data: collPayload, isLoading: collsLoading } = useQuery({
    queryKey: queryKeys.sourceCollections(scopeTag, sid),
    queryFn: () => fetchSourceCatalog<SourceCollection>(sid, "collections"),
    enabled: open && tab === "source" && !!sid,
    staleTime: STALE.long,
  })

  const sourceRoles = sourceCatalogItems(rolePayload).filter((r) => r.name)
  const sourceCollections = sourceCatalogItems(collPayload).filter((c) => c.name)
  const catalogFromGit =
    rolePayload?.catalogSource === "github" || collPayload?.catalogSource === "github"

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
    enabled: open && tab === "source",
    staleTime: STALE.long,
  })

  const installedAnsibleNames = useMemo(
    () => buildInstalledAnsibleNames(ansibleData?.roles ?? [], ansibleData?.collections ?? []),
    [ansibleData],
  )

  const roleInstalled = (role: SourceRole) =>
    sourceCatalogAnsibleInstallState(role, installedAnsibleNames) === "installed"
  const collectionInstalled = (coll: SourceCollection) =>
    sourceCatalogAnsibleInstallState(coll, installedAnsibleNames) === "installed"

  const handleInstallFromSource = async () => {
    if (!sid || (selectedRoles.size === 0 && selectedCollections.size === 0)) return
    setInstalling(true)
    try {
      const localRoles = [...selectedRoles].filter(
        (name) => sourceRoles.find((r) => r.name === name)?.scope !== "subscription",
      )
      const subRoles = [...selectedRoles].filter(
        (name) => sourceRoles.find((r) => r.name === name)?.scope === "subscription",
      )
      const localCollections = [...selectedCollections].filter(
        (name) => sourceCollections.find((c) => c.name === name)?.scope !== "subscription",
      )
      const subCollections = [...selectedCollections].filter(
        (name) => sourceCollections.find((c) => c.name === name)?.scope === "subscription",
      )

      if (localRoles.length > 0 || localCollections.length > 0) {
        const res = await fetch(`/api/sources/${encodeURIComponent(sid)}/install`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            selection: { localRoles, localCollections },
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      }

      for (const name of subRoles) {
        const result = await ludusApi.addRole(name)
        if (result.error && !/already installed|nothing to do/i.test(result.error)) {
          throw new Error(result.error)
        }
      }
      for (const name of subCollections) {
        const result = await ludusApi.addCollection(name)
        if (result.error && !/already installed|nothing to do/i.test(result.error)) {
          throw new Error(result.error)
        }
      }

      toast({ title: "Installed from source", description: "Roles and collections updated." })
      setSelectedRoles(new Set())
      setSelectedCollections(new Set())
      onChanged()
    } catch (err) {
      toast({ variant: "destructive", title: "Install failed", description: (err as Error).message })
    } finally {
      setInstalling(false)
    }
  }

  const searchGalaxy = useCallback(async () => {
    if (galaxyQuery.trim().length < 2) return
    setGalaxyLoading(true)
    try {
      const params = new URLSearchParams({ q: galaxyQuery.trim(), type: galaxyType })
      const res = await fetch(`/api/ansible/galaxy/search?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setGalaxyHits(data.items ?? [])
      setExpandedGalaxyGroups(new Set())
      setGalaxySearched(true)
    } catch (err) {
      toast({ variant: "destructive", title: "Galaxy search failed", description: (err as Error).message })
    } finally {
      setGalaxyLoading(false)
    }
  }, [galaxyQuery, galaxyType, toast])

  const groupedGalaxyHits = useMemo(() => groupGalaxySearchHits(galaxyHits), [galaxyHits])

  const toggleGalaxyGroup = (name: string) => {
    setExpandedGalaxyGroups((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const galaxyAddingKey = (name: string, version?: string) =>
    `${name}@${version ?? "latest"}`

  const handleAddGalaxyHit = async (
    name: string,
    type: "role" | "collection",
    version?: string,
  ) => {
    setAddingGalaxy(galaxyAddingKey(name, version))
    try {
      const result =
        type === "role"
          ? await ludusApi.addRole(name, version)
          : await ludusApi.addCollection(name, version)
      if (result.error) {
        if (/already installed|nothing to do/i.test(result.error)) {
          toast({ title: "Already installed", description: version ? `${name} (${version})` : name })
          onChanged()
        } else {
          toast({ variant: "destructive", title: "Install failed", description: result.error })
        }
      } else {
        toast({
          title: `${type === "role" ? "Role" : "Collection"} added`,
          description: version ? `${name} (${version})` : name,
        })
        onChanged()
      }
    } finally {
      setAddingGalaxy(null)
    }
  }

  return (
    <Card>
      <ExpandableCardTrigger
        open={open}
        onToggle={() => setOpen((o) => !o)}
        icon={GitBranch}
        title="Add from Source or Galaxy"
        subtitle="— install bundled Ansible content from registered sources or search galaxy.ansible.com"
      />
      {open && (
        <div className="px-4 pb-4 space-y-4">
          <Tabs value={tab} onValueChange={(v) => setTab(v as "source" | "galaxy")}>
            <TabsList>
              <TabsTrigger value="source">Registered sources</TabsTrigger>
              <TabsTrigger value="galaxy">Galaxy search</TabsTrigger>
            </TabsList>

            <TabsContent value="source" className="space-y-3 mt-3">
              {registeredSources.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No Ludus sources registered — add one on the Sources page first, or use Galaxy search.
                </p>
              ) : (
                <>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Source</label>
                    <select
                      className="w-full max-w-md rounded-md border border-border bg-background px-3 py-2 text-xs"
                      value={registeredSourceId}
                      onChange={(e) => {
                        setRegisteredSourceId(e.target.value)
                        setSelectedRoles(new Set())
                        setSelectedCollections(new Set())
                      }}
                    >
                      {registeredSources.map((s) => (
                        <option key={s.id} value={s.id}>
                          {registeredSourceLabel(s)}
                        </option>
                      ))}
                    </select>
                  </div>
                  {catalogFromGit && (
                    <p className="text-xs text-muted-foreground rounded border border-border bg-muted/30 px-3 py-2">
                      Catalog listed from the Git repository tree (Ludus sync cache empty). Install uses the Sources API.
                    </p>
                  )}
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase mb-2 flex items-center gap-1.5">
                        <Zap className="h-3.5 w-3.5" /> Roles
                        {!rolesLoading && <Badge variant="secondary" className="text-[10px]">{sourceRoles.length}</Badge>}
                      </p>
                      {rolesLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : sourceRoles.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No roles found for this source.</p>
                      ) : (
                        <div className="space-y-1 max-h-40 overflow-y-auto">
                          {sourceRoles.map((role) => {
                            const installed = roleInstalled(role)
                            return (
                            <label
                              key={role.name}
                              className={`flex items-center gap-2 rounded px-2 py-1 hover:bg-muted/50 ${installed ? "opacity-70 cursor-default" : "cursor-pointer"}`}
                            >
                              <Checkbox
                                checked={selectedRoles.has(role.name!)}
                                disabled={installed}
                                onCheckedChange={() =>
                                  !installed &&
                                  setSelectedRoles((prev) => {
                                    const next = new Set(prev)
                                    if (next.has(role.name!)) next.delete(role.name!)
                                    else next.add(role.name!)
                                    return next
                                  })
                                }
                              />
                              <code className="text-xs font-mono text-primary truncate">{role.name}</code>
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
                            </label>
                            )
                          })}
                        </div>
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase mb-2 flex items-center gap-1.5">
                        <Package className="h-3.5 w-3.5" /> Collections
                        {!collsLoading && <Badge variant="secondary" className="text-[10px]">{sourceCollections.length}</Badge>}
                      </p>
                      {collsLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : sourceCollections.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No collections found for this source.</p>
                      ) : (
                        <div className="space-y-1 max-h-40 overflow-y-auto">
                          {sourceCollections.map((coll) => {
                            const installed = collectionInstalled(coll)
                            return (
                            <label
                              key={coll.name}
                              className={`flex items-center gap-2 rounded px-2 py-1 hover:bg-muted/50 ${installed ? "opacity-70 cursor-default" : "cursor-pointer"}`}
                            >
                              <Checkbox
                                checked={selectedCollections.has(coll.name!)}
                                disabled={installed}
                                onCheckedChange={() =>
                                  !installed &&
                                  setSelectedCollections((prev) => {
                                    const next = new Set(prev)
                                    if (next.has(coll.name!)) next.delete(coll.name!)
                                    else next.add(coll.name!)
                                    return next
                                  })
                                }
                              />
                              <code className="text-xs font-mono text-primary truncate">{coll.name}</code>
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
                            </label>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                  {(selectedRoles.size > 0 || selectedCollections.size > 0) && (
                    <Button size="sm" onClick={handleInstallFromSource} disabled={installing} className="gap-1.5">
                      {installing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                      Install selected ({selectedRoles.size + selectedCollections.size})
                    </Button>
                  )}
                </>
              )}
            </TabsContent>

            <TabsContent value="galaxy" className="space-y-3 mt-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex gap-1">
                  {(["role", "collection"] as const).map((t) => (
                    <Button
                      key={t}
                      size="sm"
                      variant={galaxyType === t ? "secondary" : "ghost"}
                      className="text-xs capitalize"
                      onClick={() => {
                        setGalaxyType(t)
                        setGalaxyHits([])
                        setExpandedGalaxyGroups(new Set())
                        setGalaxySearched(false)
                      }}
                    >
                      {t}s
                    </Button>
                  ))}
                </div>
                <Input
                  className="max-w-xs text-xs"
                  placeholder={`Search Galaxy ${galaxyType}s…`}
                  value={galaxyQuery}
                  onChange={(e) => {
                    setGalaxyQuery(e.target.value)
                    setGalaxySearched(false)
                  }}
                  onKeyDown={(e) => e.key === "Enter" && void searchGalaxy()}
                />
                <Button size="sm" variant="outline" onClick={() => void searchGalaxy()} disabled={galaxyLoading}>
                  {galaxyLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                  Search
                </Button>
              </div>
              {galaxySearched && !galaxyLoading && galaxyHits.length === 0 && (
                <p className="text-xs text-muted-foreground">No Galaxy {galaxyType}s matched that search.</p>
              )}
              {groupedGalaxyHits.length > 0 && (
                <div className="space-y-0 max-h-64 overflow-y-auto rounded border border-border">
                  {groupedGalaxyHits.map((group) => {
                    const latest = group.versions[0]
                    const multi = group.versions.length > 1
                    const expanded = expandedGalaxyGroups.has(group.name)
                    return (
                      <div key={group.name} className="border-b border-border/50 last:border-0">
                        <div className="flex items-center gap-2 px-3 py-2">
                          {multi ? (
                            <button
                              type="button"
                              aria-expanded={expanded}
                              aria-label={expanded ? "Collapse versions" : "Expand versions"}
                              className="shrink-0 text-muted-foreground hover:text-foreground"
                              onClick={() => toggleGalaxyGroup(group.name)}
                            >
                              {expanded ? (
                                <ChevronDown className="h-3.5 w-3.5" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5" />
                              )}
                            </button>
                          ) : (
                            <span className="w-3.5 shrink-0" aria-hidden />
                          )}
                          <code className="text-xs font-mono text-primary flex-1 truncate">{group.name}</code>
                          {latest && (
                            <Badge variant="outline" className="text-[10px] shrink-0">
                              {latest}
                              {multi ? " latest" : ""}
                            </Badge>
                          )}
                          {multi && !expanded && (
                            <Badge variant="secondary" className="text-[10px] shrink-0">
                              {group.versions.length} versions
                            </Badge>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs shrink-0"
                            disabled={addingGalaxy === galaxyAddingKey(group.name, latest)}
                            onClick={() => void handleAddGalaxyHit(group.name, group.type, latest)}
                          >
                            {addingGalaxy === galaxyAddingKey(group.name, latest) ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              "Add"
                            )}
                          </Button>
                        </div>
                        {group.description && !expanded && (
                          <p className="px-3 pb-2 -mt-1 text-[10px] text-muted-foreground line-clamp-2 pl-9">
                            {group.description}
                          </p>
                        )}
                        {multi && expanded && (
                          <div className="px-3 pb-2 space-y-1">
                            {group.description && (
                              <p className="text-[10px] text-muted-foreground line-clamp-2 pl-6 mb-1">
                                {group.description}
                              </p>
                            )}
                            {group.versions.map((ver) => (
                              <div
                                key={ver}
                                className="flex items-center gap-2 rounded px-2 py-1.5 bg-muted/30 ml-5"
                              >
                                <Badge variant="outline" className="text-[10px] shrink-0">
                                  {ver}
                                </Badge>
                                {ver === latest && (
                                  <span className="text-[10px] text-muted-foreground">latest</span>
                                )}
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-xs shrink-0 ml-auto"
                                  disabled={addingGalaxy === galaxyAddingKey(group.name, ver)}
                                  onClick={() => void handleAddGalaxyHit(group.name, group.type, ver)}
                                >
                                  {addingGalaxy === galaxyAddingKey(group.name, ver) ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    "Add"
                                  )}
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      )}
    </Card>
  )
}
