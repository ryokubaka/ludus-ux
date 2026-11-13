"use client"

import { useCallback, useEffect, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { ChevronRight, ExternalLink, Loader2, RefreshCw, Server } from "lucide-react"
import { ReleasePager } from "@/components/settings/release-pager"
import { releasePageIndex, releasePageSlice } from "@/components/settings/release-page"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/core/utils"
import { ludusVersionLabel, type LudusRelease, type LudusReleasesSnapshot } from "@/lib/ludus/ludus-releases"
import { VersionStatusCard, type VersionStatusState } from "@/components/settings/version-status-card"

type UpgradeStatus = {
  active: boolean
  logTail: string
  error?: string
}

function NoteText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/)
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={i} className="font-medium text-foreground">{part.slice(2, -2)}</strong>
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return <code key={i} className="text-primary text-[11px] bg-muted px-1 py-0.5 rounded">{part.slice(1, -1)}</code>
        }
        return <span key={i}>{part}</span>
      })}
    </>
  )
}

function LudusReleaseNotes({ releases }: { releases: LudusRelease[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [page, setPage] = useState(0)
  const withNotes = releases.filter((release) => (release.notes ?? "").trim())
  const pageIndex = releasePageIndex(withNotes.length, page)
  const visible = releasePageSlice(withNotes, pageIndex)
  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-card">
      <div className="px-4 py-3 border-b border-border/50">
        <span className="text-sm font-medium">Release notes</span>
      </div>
      <div className="divide-y divide-border/40">
        {withNotes.length === 0 && (
          <p className="px-4 py-6 text-sm text-muted-foreground">No release notes published.</p>
        )}
        {visible.map((release, index) => {
          const isOpen = open[release.tag] ?? (pageIndex === 0 && index === 0)
          return (
            <div key={release.tag} className="px-4 py-2">
              <button
                type="button"
                className="flex w-full items-center gap-2 text-left"
                aria-expanded={isOpen}
                onClick={() => setOpen((prev) => ({ ...prev, [release.tag]: !isOpen }))}
              >
                <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-transform", isOpen && "rotate-90")} />
                <span className="font-mono text-sm">{release.tag}</span>
                {release.publishedAt && (
                  <span className="text-xs text-muted-foreground">{release.publishedAt.slice(0, 10)}</span>
                )}
              </button>
              {isOpen && (
                <div className="mt-2 space-y-1 pl-5">
                  {release.notes.split("\n").map((line, lineIndex) => {
                    const trimmed = line.trim()
                    if (!trimmed || trimmed.startsWith("## ")) return null
                    if (trimmed.startsWith("### ")) {
                      return (
                        <p key={lineIndex} className="pt-1.5 text-[11px] font-semibold text-foreground">
                          {trimmed.slice(4)}
                        </p>
                      )
                    }
                    const bullet = trimmed.startsWith("- ")
                    return (
                      <p key={lineIndex} className="text-xs leading-relaxed text-muted-foreground">
                        {bullet ? "· " : ""}
                        <NoteText text={bullet ? trimmed.slice(2) : trimmed} />
                      </p>
                    )
                  })}
                </div>
              )}
            </div>
          )
          })}
      </div>
      <ReleasePager page={pageIndex} count={withNotes.length} onPage={setPage} label="Ludus release notes" />
    </div>
  )
}

function exitCode(log: string): number | null {
  const matches = log.match(/LUDUS_UPGRADE_EXIT:(\d+)/g)
  if (!matches?.length) return null
  return Number(matches[matches.length - 1].split(":")[1])
}

export function LudusReleasesPanel({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient()
  const [releases, setReleases] = useState<LudusReleasesSnapshot | null>(null)
  const [checking, setChecking] = useState(false)
  const [releasePage, setReleasePage] = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pending, setPending] = useState<LudusRelease | null>(null)
  const [starting, setStarting] = useState(false)
  const [upgrading, setUpgrading] = useState<string | null>(null)
  const [upgradeError, setUpgradeError] = useState<string | null>(null)
  const [logTail, setLogTail] = useState("")

  const loadReleases = useCallback(async (refresh = false) => {
    const url = refresh ? "/api/ludus/releases?refresh=1" : "/api/ludus/releases"
    const res = await fetch(url, { cache: "no-store" })
    if (!res.ok) throw new Error("Could not load releases")
    const body = (await res.json()) as LudusReleasesSnapshot
    setReleases(body)
    return body
  }, [])

  const refreshVersion = useCallback(() => {
    void queryClient.invalidateQueries({
      predicate: (q) => q.queryKey.includes("version") || (q.queryKey[0] === "ludus" && q.queryKey[1] === "releases"),
    })
  }, [queryClient])

  useEffect(() => {
    let cancelled = false
    loadReleases().catch(() => {
      if (!cancelled) setLoadError("Could not check for Ludus releases.")
    })
    return () => {
      cancelled = true
    }
  }, [loadReleases])

  const pollUpgrade = useCallback(async () => {
    const res = await fetch("/api/ludus/releases/upgrade", { cache: "no-store" })
    if (!res.ok) return
    const body = (await res.json()) as UpgradeStatus
    if (body.logTail) setLogTail(body.logTail)
    if (body.error) setUpgradeError(body.error)
    const code = exitCode(body.logTail)
    if (!body.active && code != null) {
      setUpgrading(null)
      if (code === 0) {
        setUpgradeError(null)
        await loadReleases(true)
        refreshVersion()
      } else if (!body.error) {
        setUpgradeError("The Ludus upgrade failed. The log is below.")
      }
    }
  }, [loadReleases, refreshVersion])

  useEffect(() => {
    if (!upgrading) return
    const id = setInterval(() => { void pollUpgrade() }, 2000)
    return () => clearInterval(id)
  }, [upgrading, pollUpgrade])

  const recheck = useCallback(async () => {
    setChecking(true)
    setLoadError(null)
    try {
      await loadReleases(true)
      refreshVersion()
    } catch {
      setLoadError("Could not check for Ludus releases.")
    } finally {
      setChecking(false)
    }
  }, [loadReleases, refreshVersion])

  const startUpgrade = useCallback(async () => {
    if (!pending) return
    setStarting(true)
    setUpgradeError(null)
    try {
      const res = await fetch("/api/ludus/releases/upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag: pending.tag }),
      })
      const body = (await res.json()) as { error?: string; tag?: string }
      if (!res.ok) {
        setUpgradeError(body.error || "The host did not start the upgrade.")
        return
      }
      setUpgrading(body.tag || pending.tag)
      setPending(null)
    } catch {
      setUpgradeError("The host did not start the upgrade.")
    } finally {
      setStarting(false)
    }
  }, [pending])

  const current = releases?.current ? ludusVersionLabel(releases.current) || "—" : "—"
  const latestUpgrade = releases?.releases.find((release) => release.canUpgrade) ?? null
  const status: VersionStatusState = upgrading
    ? "working"
    : !releases && !loadError
      ? "loading"
      : releases?.updateAvailable
        ? "update"
        : releases?.latestStable
          ? "current"
          : "unknown"

  return (
    <div className="grid gap-4 lg:row-span-4 lg:[grid-template-rows:subgrid]">
      <div className="flex h-full flex-wrap items-center gap-4 rounded-lg border border-border bg-card px-4 py-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-muted/30 text-primary">
          <Server className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">Ludus</h2>
            <Badge variant="outline" className="font-mono text-xs">{current}</Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">Range server on this host</p>
        </div>
        <a
          href="https://gitlab.com/badsectorlabs/ludus/-/releases"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted-foreground hover:text-primary"
        >
          Releases
        </a>
      </div>

      <VersionStatusCard
        product="Ludus"
        state={status}
        current={current === "—" ? "" : current}
        latest={releases?.latestStable}
        detail={
          upgrading
            ? `Downloading ${upgrading}. The Ludus API drops until the service is back. LUX stays up.`
            : releases?.error || loadError || undefined
        }
        action={
          isAdmin && status === "update" && latestUpgrade ? (
            <Button size="sm" variant="warning" disabled={!!upgrading} onClick={() => setPending(latestUpgrade)}>
              Upgrade
            </Button>
          ) : null
        }
      />

      <div className="flex h-full flex-col rounded-lg border border-border bg-card">
        {(loadError || releases?.error || upgradeError) && (
          <p className="px-4 pt-3 text-xs text-destructive">{upgradeError || loadError || releases?.error}</p>
        )}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border/50">
          <span className="text-sm font-medium shrink-0">Releases</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="shrink-0"
            disabled={checking || !!upgrading}
            onClick={() => { void recheck() }}
          >
            {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Check again
          </Button>
        </div>
        <div className="divide-y divide-border/40">
          {!releases && !loadError && (
            <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Checking GitLab releases…</span>
            </div>
          )}
          {releases && releases.releases.length === 0 && (
            <p className="px-4 py-6 text-sm text-muted-foreground text-center">No published releases found.</p>
          )}
          {releasePageSlice(releases?.releases ?? [], releasePage).map((release) => (
            <div key={release.tag} className="flex items-center gap-3 px-4 py-2">
              <div className="min-w-0 flex-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-mono text-sm">{release.tag}</span>
                {release.relation === "current" && <Badge variant="secondary">Current</Badge>}
                {release.prerelease && <Badge variant="outline">Pre-release</Badge>}
                {release.publishedAt && (
                  <span className="text-xs text-muted-foreground">{release.publishedAt.slice(0, 10)}</span>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Button variant="ghost" size="icon-sm" asChild>
                  <a
                    href={release.htmlUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Release notes for ${release.tag}`}
                  >
                    <ExternalLink />
                  </a>
                </Button>
                {isAdmin && release.canUpgrade && (
                  <Button size="sm" disabled={!!upgrading} onClick={() => setPending(release)}>
                    Upgrade
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
        <ReleasePager
          page={releasePage}
          count={releases?.releases.length ?? 0}
          onPage={setReleasePage}
          label="Ludus releases"
        />
        {logTail && (upgrading || upgradeError) && (
          <pre className="mx-4 mb-4 max-h-40 overflow-auto overscroll-y-contain rounded-md border border-border bg-muted/40 p-3 text-xs leading-relaxed font-mono whitespace-pre-wrap">
            {logTail}
          </pre>
        )}
        <Dialog open={!!pending} onOpenChange={(open) => { if (!open && !starting) setPending(null) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Upgrade Ludus to {pending?.tag}?</DialogTitle>
            <DialogDescription>
              Nothing changes until you confirm. The host then downloads that release and updates the Ludus server.
            </DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
            <li>Download the official server package for {pending?.tag} from GitLab and check its checksum.</li>
            <li>Run that copy with <span className="font-mono">--update</span>. The installed binary cannot update itself.</li>
            <li>The Ludus API stops and starts again. LUX stays up. Running VMs stay up.</li>
            <li>The upgrade does not start while Ansible or Packer is running.</li>
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)} disabled={starting}>
              Cancel
            </Button>
            <Button onClick={() => { void startUpgrade() }} disabled={starting}>
              {starting && <Loader2 className="h-4 w-4 animate-spin" />}
              Upgrade
            </Button>
          </DialogFooter>
        </DialogContent>
        </Dialog>
      </div>

      <LudusReleaseNotes releases={releases?.releases ?? []} />
    </div>
  )
}
