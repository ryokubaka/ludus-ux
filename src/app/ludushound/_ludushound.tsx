"use client"

import Link from "next/link"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { STALE } from "@/lib/query-client"
import { useEffectiveScopeTag } from "@/lib/effective-scope-context"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  GitBranch,
  Plus,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  ExternalLink,
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { useImpersonation } from "@/lib/impersonation-context"
import type { LudushoundStatus } from "@/lib/types"
import { useState } from "react"

export function LudushoundPageClient() {
  const scopeTag = useEffectiveScopeTag()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { impersonationHeaders } = useImpersonation()
  const [busy, setBusy] = useState<string | null>(null)

  const statusQuery = useQuery({
    queryKey: queryKeys.ludushoundStatusScoped(scopeTag),
    queryFn: async (): Promise<LudushoundStatus> => {
      const res = await fetch("/api/ludushound/status", { headers: { ...impersonationHeaders } })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || "Failed to load status")
      return data
    },
    staleTime: STALE.short,
  })

  const workspacesQuery = useQuery({
    queryKey: queryKeys.ludushoundWorkspacesList(scopeTag),
    queryFn: async () => {
      const res = await fetch("/api/ludushound/workspaces", { headers: { ...impersonationHeaders } })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || "Failed to list workspaces")
      return (data.workspaces || []) as Array<{ id: string; rangeId?: string; mtime?: string }>
    },
    staleTime: STALE.short,
  })

  const status = statusQuery.data

  const runAction = async (key: string, url: string, body?: object) => {
    setBusy(key)
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...impersonationHeaders },
        body: body ? JSON.stringify(body) : undefined,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      toast({ title: "Done", description: data.detail || "Success" })
      await queryClient.invalidateQueries({ queryKey: queryKeys.ludushoundStatus() })
    } catch (err) {
      toast({ title: "Failed", description: (err as Error).message, variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  const Flag = ({ ok, label }: { ok: boolean; label: string }) => (
    <div className="flex items-center gap-2 text-sm">
      {ok ? (
        <CheckCircle2 className="h-4 w-4 text-status-success" />
      ) : (
        <XCircle className="h-4 w-4 text-status-error" />
      )}
      <span>{label}</span>
    </div>
  )

  return (
    <div className="space-y-6 p-6 max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <GitBranch className="h-6 w-6" />
            LudusHound
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Deploy Active Directory replicas from BloodHound data via{" "}
            <a
              href="https://github.com/bagelByt3s/LudusHound"
              target="_blank"
              rel="noreferrer"
              className="text-primary underline inline-flex items-center gap-1"
            >
              bagelByt3s/LudusHound
              <ExternalLink className="h-3 w-3" />
            </a>
            . Point LudusHound at an existing Neo4j (or FilesMap / Attack Path).
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void statusQuery.refetch()
              void workspacesQuery.refetch()
            }}
            disabled={statusQuery.isFetching}
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${statusQuery.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button asChild size="sm">
            <Link href="/ludushound/new">
              <Plus className="h-4 w-4 mr-1" />
              Deploy New
            </Link>
          </Button>
        </div>
      </div>

      {status?.message && (
        <Alert>
          <AlertDescription className="text-sm">{status.message}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Host readiness</CardTitle>
          <CardDescription>
            Clone the repo on the Ludus host, then build/install from LUX. Missing Go is installed
            automatically under <code className="text-xs">/usr/local/go</code> when you build.
            Path: <code className="text-xs">{status?.ludushoundPath || "/opt/LudusHound"}</code>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {statusQuery.isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                <Flag ok={!!status?.repoPresent} label="Repo present" />
                <Flag ok={!!status?.binaryPresent} label="Binary built" />
                <Flag ok={!!status?.goAvailable} label="Go toolchain available" />
                <Flag ok={!!status?.collectionTarballPresent} label="Collection tarball present" />
                <Flag ok={!!status?.collectionInstalled} label="bagelByt3s.ludushound installed" />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void runAction("clone", "/api/ludushound/clone-repo")}
                >
                  {busy === "clone" && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                  {status?.repoPresent
                    ? `Update repo (git pull)`
                    : `Clone repo to ${status?.ludushoundPath || "/opt/LudusHound"}`}
                </Button>
                {!status?.goAvailable && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => void runAction("go", "/api/ludushound/install-go")}
                  >
                    {busy === "go" && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                    Install Go toolchain
                  </Button>
                )}
                <Button
                  size="sm"
                  disabled={!status?.repoPresent || busy !== null}
                  onClick={() =>
                    void runAction("collection", "/api/ludushound/install-collection", {
                      buildBinary: !status?.binaryPresent,
                    })
                  }
                >
                  {busy === "collection" && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                  {status?.collectionInstalled ? "Reinstall collection" : "Install collection"}
                  {!status?.binaryPresent ? " + build binary" : ""}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Workspaces</CardTitle>
          <CardDescription>Prior LudusHound runs under the install path.</CardDescription>
        </CardHeader>
        <CardContent>
          {workspacesQuery.isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (workspacesQuery.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No workspaces yet. Deploy a new range.</p>
          ) : (
            <ul className="space-y-2">
              {workspacesQuery.data!.map((w) => (
                <li
                  key={w.id}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
                >
                  <span className="font-mono">{w.id}</span>
                  <div className="flex items-center gap-2">
                    {w.rangeId ? <Badge variant="secondary">{w.rangeId}</Badge> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Credits: LudusHound by bagelByt3s (idea: Erik Hunstad / Ludus). BloodHound CE role by Bad Sector
        Labs. BloodHound CE by SpecterOps. LUX wraps these tools; no upstream source is vendored.
      </p>
    </div>
  )
}
