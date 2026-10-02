"use client"

import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, ExternalLink, Loader2 } from "lucide-react"
import { previewSlice, ShowAllBar } from "@/components/ui/show-all-bar"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  LUX_VERSION_MANAGEMENT_SINCE,
  luxUpgradeFailureFromLog,
  type LuxRelease,
  type LuxVersionRelation,
} from "@/lib/lux-version"

const DOCS_HREF =
  "https://github.com/ryokubaka/ludus-ux/blob/main/docs/getting-started.md#upgrade-and-downgrade"

type ReleasesResponse = {
  current: string
  latestStable: string | null
  updateAvailable: boolean
  releases: LuxRelease[]
  error?: string
  logTail?: string
}

type HostStatus = {
  canSwitch: boolean
  repoPath: string | null
  dirty: boolean
  checkout: string | null
  reason: string | null
  logTail: string
}

function bareVersion(value: string): string {
  return value.trim().replace(/^v/, "")
}

function relationLabel(relation: LuxVersionRelation): string {
  if (relation === "upgrade") return "Upgrade"
  if (relation === "downgrade") return "Downgrade"
  return "Current"
}

export function LuxReleasesPanel({ isAdmin }: { isAdmin: boolean }) {
  const [releases, setReleases] = useState<ReleasesResponse | null>(null)
  const [showAllReleases, setShowAllReleases] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [host, setHost] = useState<HostStatus | null>(null)
  const [hostLoading, setHostLoading] = useState(false)
  const [pending, setPending] = useState<LuxRelease | null>(null)
  const [ack, setAck] = useState(false)
  const [starting, setStarting] = useState(false)
  const [switchingTag, setSwitchingTag] = useState<string | null>(null)
  const [switchError, setSwitchError] = useState<string | null>(null)
  const [logTail, setLogTail] = useState("")

  const loadReleases = useCallback(async () => {
    const res = await fetch("/api/lux/releases", { cache: "no-store" })
    if (!res.ok) throw new Error("Could not load releases")
    const body = (await res.json()) as ReleasesResponse
    setReleases(body)
    if (body.logTail) setLogTail(body.logTail)
    return body
  }, [])

  useEffect(() => {
    let cancelled = false
    loadReleases()
      .catch(() => {
        if (!cancelled) setLoadError("Could not check for LUX releases.")
      })
    return () => {
      cancelled = true
    }
  }, [loadReleases])

  useEffect(() => {
    if (!isAdmin) return
    let cancelled = false
    setHostLoading(true)
    fetch("/api/lux/releases/host", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return null
        return (await res.json()) as HostStatus
      })
      .then((body) => {
        if (cancelled || !body) return
        setHost(body)
        if (body.logTail) setLogTail(body.logTail)
      })
      .catch(() => {
        if (!cancelled) {
          setHost({
            canSwitch: false,
            repoPath: null,
            dirty: false,
            checkout: null,
            reason: "Could not check whether this host can switch LUX versions.",
            logTail: "",
          })
        }
      })
      .finally(() => {
        if (!cancelled) setHostLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isAdmin])

  useEffect(() => {
    if (!switchingTag) return
    let stopped = false
    const startedAt = Date.now()

    const tick = async () => {
      if (stopped) return
      let healthVersion = ""
      try {
        const health = await fetch("/api/health", { cache: "no-store" })
        if (health.ok) {
          const body = (await health.json()) as { version?: string }
          healthVersion = body.version ?? ""
          if (!stopped && healthVersion && bareVersion(healthVersion) === bareVersion(switchingTag)) {
            window.location.reload()
            return
          }
        }
      } catch {
        // Container is down while Docker rebuilds.
      }
      if (stopped) return

      try {
        const rel = await fetch("/api/lux/releases", { cache: "no-store" })
        if (rel.ok) {
          const body = (await rel.json()) as ReleasesResponse
          if (stopped) return
          const tail = body.logTail ?? ""
          if (tail) setLogTail(tail)
          const failure = luxUpgradeFailureFromLog(tail, switchingTag)
          if (failure && bareVersion(healthVersion) !== bareVersion(switchingTag)) {
            setSwitchError(failure)
            setSwitchingTag(null)
            return
          }
        }
      } catch {
        // The container is rebuilding. Keep polling health.
      }
      if (stopped) return

      if (Date.now() - startedAt > 20 * 60 * 1000) {
        setSwitchError("Timed out waiting for LUX to come back on the selected version.")
        setSwitchingTag(null)
      }
    }

    void tick()
    const id = window.setInterval(() => { void tick() }, 2000)
    return () => {
      stopped = true
      window.clearInterval(id)
    }
  }, [switchingTag])

  const latest = releases?.releases.find((r) => r.tag === releases.latestStable) ?? null
  const canAct = isAdmin && !!host?.canSwitch && !switchingTag && !starting

  const openConfirm = (release: LuxRelease) => {
    setPending(release)
    setAck(false)
    setSwitchError(null)
  }

  const startSwitch = async () => {
    if (!pending) return
    setStarting(true)
    setSwitchError(null)
    try {
      const res = await fetch("/api/lux/releases/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tag: pending.tag,
          acknowledgeVersionManagementLoss: ack,
        }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string; started?: boolean }
      if (!res.ok) {
        setSwitchError(body.error || "Could not start the version switch.")
        return
      }
      setSwitchingTag(pending.tag)
      setPending(null)
    } catch {
      setSwitchError("Could not start the version switch.")
    } finally {
      setStarting(false)
    }
  }

  const needsAck = !!pending?.losesVersionManagement
  const confirmBlocked = needsAck && !ack

  return (
    <div className="space-y-3">
      {releases?.updateAvailable && latest && (
        <Alert variant="warning">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>LUX {latest.tag} is available</AlertTitle>
          <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>This install is v{releases.current}. A newer stable release is on GitHub.</span>
            {isAdmin && (
              <Button
                size="sm"
                variant="warning"
                disabled={!canAct}
                onClick={() => openConfirm(latest)}
              >
                Upgrade
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {loadError && (
        <p className="text-xs text-muted-foreground">{loadError}</p>
      )}
      {releases?.error && (
        <p className="text-xs text-muted-foreground">{releases.error}</p>
      )}

      {isAdmin && host && !host.canSwitch && (
        <Alert>
          <AlertDescription>
            {host.reason}{" "}
            <a
              href={DOCS_HREF}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-primary"
            >
              Upgrade and downgrade
            </a>
          </AlertDescription>
        </Alert>
      )}

      {switchingTag && (
        <Alert>
          <Loader2 className="h-4 w-4 animate-spin" />
          <AlertTitle>Switching to {switchingTag}</AlertTitle>
          <AlertDescription>
            LUX is checking out that release and rebuilding. This page will reconnect when the new version is up.
          </AlertDescription>
        </Alert>
      )}

      {switchError && (
        <Alert variant="destructive">
          <AlertDescription>{switchError}</AlertDescription>
        </Alert>
      )}

      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
          <span className="text-sm font-medium">Releases</span>
          {hostLoading && isAdmin && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
        <div className="divide-y divide-border/40">
          {!releases && !loadError && (
            <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Checking GitHub…</span>
            </div>
          )}
          {releases && releases.releases.length === 0 && (
            <p className="px-4 py-6 text-sm text-muted-foreground text-center">No published releases found.</p>
          )}
          {previewSlice(releases?.releases ?? [], showAllReleases).map((release) => (
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
                {release.htmlUrl && (
                  <Button variant="ghost" size="icon-sm" asChild>
                    <a
                      href={release.htmlUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Release notes for ${release.tag}`}
                      title="Release notes"
                    >
                      <ExternalLink />
                    </a>
                  </Button>
                )}
                {isAdmin && release.relation !== "current" && (
                  <Button
                    size="sm"
                    variant={release.relation === "downgrade" ? "outline" : "default"}
                    disabled={!canAct}
                    onClick={() => openConfirm(release)}
                  >
                    {relationLabel(release.relation)}
                  </Button>
                )}
              </div>
            </div>
          ))}
          <ShowAllBar
            expanded={showAllReleases}
            count={releases?.releases.length ?? 0}
            onToggle={() => setShowAllReleases((v) => !v)}
          />
        </div>
      </div>

      {logTail && (switchingTag || switchError) && (
        <pre className="max-h-40 overflow-auto overscroll-y-contain rounded-md border border-border bg-muted/40 p-3 text-xs leading-relaxed font-mono whitespace-pre-wrap">
          {logTail}
        </pre>
      )}

      <Dialog open={!!pending} onOpenChange={(open) => { if (!open && !starting) setPending(null) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {pending?.relation === "downgrade" ? "Downgrade" : "Upgrade"} to {pending?.tag}?
            </DialogTitle>
            <DialogDescription>
              Nothing changes until you confirm. LUX will then switch this install and restart.
            </DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
            <li>Check out {pending?.tag} in the git clone on this Docker host.</li>
            <li>Rebuild the image and restart the stack. This page disconnects until the new version is up.</li>
            <li>Settings, the database, and files under <span className="font-mono">./data</span>, <span className="font-mono">./ssh</span>, and <span className="font-mono">.env</span> stay on the host.</li>
            {host?.dirty && (
              <li>The host checkout has uncommitted changes. They will be discarded.</li>
            )}
          </ul>
          {pending?.relation === "downgrade" && (
            <Alert variant="warning">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Database and environment expectations are forward-compatible only when the changelog says so. An older release can refuse settings or schema written by this version.
              </AlertDescription>
            </Alert>
          )}
          {pending?.losesVersionManagement && (
            <Alert variant="warning">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="space-y-2">
                <p>
                  {pending.tag} is older than v{LUX_VERSION_MANAGEMENT_SINCE}. That release has no Releases panel and no in-app upgrade or downgrade.
                </p>
                <p>
                  After the restart, this list, the update marker in the sidebar, and these buttons are gone. The only way to move to another version is on the Docker host, from the git clone: <span className="font-mono">bash scripts/upgrade.sh</span>. In-app version management comes back only if that command checks out v{LUX_VERSION_MANAGEMENT_SINCE} or newer.
                </p>
              </AlertDescription>
            </Alert>
          )}
          {pending?.losesVersionManagement && (
            <div className="flex items-start gap-2">
              <Checkbox
                id="lux-lose-version-mgmt"
                checked={ack}
                onCheckedChange={(v) => setAck(v === true)}
              />
              <Label htmlFor="lux-lose-version-mgmt" className="text-sm font-normal leading-snug">
                I understand this downgrade removes the Releases panel and in-app upgrades and downgrades.
              </Label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)} disabled={starting}>
              Cancel
            </Button>
            <Button
              variant={pending?.relation === "downgrade" ? "warning" : "default"}
              onClick={() => { void startSwitch() }}
              disabled={starting || confirmBlocked}
            >
              {starting && <Loader2 className="h-4 w-4 animate-spin" />}
              {pending?.relation === "downgrade" ? "Downgrade" : "Upgrade"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
