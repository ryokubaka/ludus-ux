"use client"

import { useState, useEffect, useMemo, Suspense } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Server,
  Terminal,
  Info,
  Eye,
  EyeOff,
  KeyRound,
  ImageIcon,
  Upload,
  Trash2,
  RefreshCw,
  Save,
  ChevronRight,
  Package,
  BookOpen,
  Plus,
  Bug,
  Minus,
  ArrowRightLeft,
  ShieldAlert,
  Zap,
} from "lucide-react"
import type { LucideProps } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { ludusApi } from "@/lib/api"
import { APP_VERSION, APP_VERSION_LABEL } from "@/lib/changelog"

// ── Types ──────────────────────────────────────────────────────────────────

interface Settings {
  ludusUrl: string
  ludusAdminUrl: string
  verifyTls: boolean
  sshHost: string
  sshPort: number
  goadPath: string
  goadEnabled: boolean
  rootApiKey?: string
  proxmoxSshUser?: string
  proxmoxSshPassword?: string
  proxmoxSshKeyPath?: string
}

interface SessionInfo {
  username: string
  isAdmin: boolean
}

interface Dependency {
  name: string
  version: string
}

// ── Changelog parsing ──────────────────────────────────────────────────────

type TagMeta = { label: string; className: string; Icon: React.FC<LucideProps> }

const TAG_META: Record<string, TagMeta> = {
  add:      { label: "Add",      Icon: Plus,           className: "bg-green-500/15 text-green-400 border-green-500/30" },
  fix:      { label: "Fix",      Icon: Bug,            className: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  change:   { label: "Change",   Icon: ArrowRightLeft, className: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  improve:  { label: "Enhance",  Icon: Zap,            className: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  security: { label: "Security", Icon: ShieldAlert,    className: "bg-red-500/15 text-red-400 border-red-500/30" },
  remove:   { label: "Remove",   Icon: Minus,          className: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
}

interface ParsedEntry {
  tag: string
  text: string
}

interface ParsedGroup {
  name: string | null  // null = ungrouped (no **Header**)
  entries: ParsedEntry[]
}

interface ParsedVersion {
  title: string
  date: string
  groups: ParsedGroup[]
}

function parseChangelog(md: string): ParsedVersion[] {
  const lines = md.split("\n")
  const versions: ParsedVersion[] = []
  let current: ParsedVersion | null = null
  let currentGroup: ParsedGroup | null = null

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (current) versions.push(current)
      const title = line.replace(/^## /, "").trim()
      const dateMatch = title.match(/(\d{4}-\d{2}-\d{2})/)
      current = { title, date: dateMatch?.[1] ?? "", groups: [] }
      currentGroup = null
      continue
    }
    if (!current) continue
    // **Group header** e.g. **LUX** or **GOAD**
    const groupMatch = /^\*\*(.+?)\*\*$/.exec(line.trim())
    if (groupMatch) {
      currentGroup = { name: groupMatch[1], entries: [] }
      current.groups.push(currentGroup)
      continue
    }
    // - [Tag] Description
    const m = line.match(/^-\s+\[(\w+)\]\s+(.+)$/)
    if (m) {
      if (!currentGroup) {
        currentGroup = { name: null, entries: [] }
        current.groups.push(currentGroup)
      }
      currentGroup.entries.push({ tag: m[1].toLowerCase(), text: m[2].trim() })
    }
  }
  if (current) versions.push(current)
  return versions
}

function allEntries(v: ParsedVersion): ParsedEntry[] {
  return v.groups.flatMap((g) => g.entries)
}

function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/)
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={i} className="font-medium text-foreground">{part.slice(2, -2)}</strong>
    if (part.startsWith("`") && part.endsWith("`"))
      return <code key={i} className="text-primary text-[11px] bg-muted px-1 py-0.5 rounded">{part.slice(1, -1)}</code>
    const lm = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (lm)
      return <a key={i} href={lm[2]} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 hover:text-primary/80">{lm[1]}</a>
    return <span key={i}>{part}</span>
  })
}

// ── Release notes section ──────────────────────────────────────────────────

function ReleaseNotes() {
  const [raw, setRaw] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [expanded, setExpanded] = useState<Record<number, boolean>>({ 0: true })

  useEffect(() => {
    fetch("/api/changelog")
      .then((r) => { if (!r.ok) throw new Error(); return r.text() })
      .then(setRaw)
      .catch(() => setError(true))
  }, [])

  const versions = useMemo(() => (raw ? parseChangelog(raw) : []), [raw])

  if (error) return <p className="text-sm text-destructive py-4 text-center">Could not load changelog.</p>
  if (!raw) return (
    <div className="flex items-center justify-center py-8 text-muted-foreground gap-2">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span className="text-sm">Loading…</span>
    </div>
  )

  const GROUP_COLORS: Record<string, string> = {
    LUX:  "text-primary border-primary/40 bg-primary/10",
    GOAD: "text-orange-400 border-orange-400/40 bg-orange-400/10",
  }

  return (
    <div className="divide-y divide-border/40">
      {versions.map((v, vi) => {
        const isOpen = !!expanded[vi]
        const entries = allEntries(v)
        const tagCounts = entries.reduce<Record<string, number>>((acc, e) => {
          acc[e.tag] = (acc[e.tag] ?? 0) + 1
          return acc
        }, {})
        const hasGroups = v.groups.some((g) => g.name !== null)
        return (
          <div key={vi} className={vi === 0 ? "pb-3" : "py-3"}>
            <button
              type="button"
              onClick={() => setExpanded((p) => ({ ...p, [vi]: !p[vi] }))}
              className="w-full flex items-center gap-2 text-left py-1 hover:text-primary transition-colors group"
              aria-expanded={isOpen}
            >
              <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground/60 transition-transform shrink-0 ${isOpen ? "rotate-90" : ""}`} />
              <span className="text-sm font-semibold text-foreground group-hover:text-primary flex-1">{v.title}</span>
              <span className="text-xs text-muted-foreground/50 font-mono shrink-0">{entries.length} changes</span>
              {vi === 0 && <Badge variant="outline" className="text-[10px] h-4 px-1.5 shrink-0">Latest</Badge>}
            </button>
            {isOpen && (
              <div className="mt-2 pl-5 space-y-1.5">
                {/* Tag summary pills */}
                <div className="flex flex-wrap gap-1 mb-3">
                  {Object.entries(tagCounts).map(([tag, count]) => {
                    const meta = TAG_META[tag]
                    if (!meta) return null
                    return (
                      <span key={tag} className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border ${meta.className}`}>
                        <meta.Icon className="h-2.5 w-2.5" />
                        {meta.label} {count}
                      </span>
                    )
                  })}
                </div>
                {/* Entries — grouped under LUX / GOAD labels when present */}
                {hasGroups ? (
                  <div className="space-y-3">
                    {v.groups.map((group, gi) => (
                      <div key={gi}>
                        {group.name && (
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border tracking-wide ${GROUP_COLORS[group.name] ?? "text-muted-foreground border-border bg-muted"}`}>
                              {group.name}
                            </span>
                            <div className="flex-1 h-px bg-border/40" />
                          </div>
                        )}
                        <div className="space-y-1.5">
                          {group.entries.map((entry, ei) => {
                            const meta: TagMeta = TAG_META[entry.tag] ?? { label: entry.tag, Icon: ArrowRightLeft, className: "bg-muted text-muted-foreground border-border" }
                            return (
                              <div key={ei} className="flex items-start gap-2 text-xs">
                                <span className={`inline-flex items-center gap-1 shrink-0 mt-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded border leading-none ${meta.className}`}>
                                  <meta.Icon className="h-2.5 w-2.5" />
                                  {meta.label}
                                </span>
                                <span className="text-muted-foreground leading-relaxed">{renderInline(entry.text)}</span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {entries.map((entry, ei) => {
                      const meta: TagMeta = TAG_META[entry.tag] ?? { label: entry.tag, Icon: ArrowRightLeft, className: "bg-muted text-muted-foreground border-border" }
                      return (
                        <div key={ei} className="flex items-start gap-2 text-xs">
                          <span className={`inline-flex items-center gap-1 shrink-0 mt-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded border leading-none ${meta.className}`}>
                            <meta.Icon className="h-2.5 w-2.5" />
                            {meta.label}
                          </span>
                          <span className="text-muted-foreground leading-relaxed">{renderInline(entry.text)}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Dependencies section ───────────────────────────────────────────────────

function DependenciesList() {
  const [deps, setDeps] = useState<Dependency[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch("/api/about")
      .then((r) => { if (!r.ok) throw new Error(); return r.json() })
      .then((d: { dependencies: Dependency[] }) => setDeps(d.dependencies))
      .catch(() => setError(true))
  }, [])

  if (error) return <p className="text-sm text-destructive py-4 text-center">Could not load dependencies.</p>
  if (!deps) return (
    <div className="flex items-center justify-center py-8 text-muted-foreground gap-2">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span className="text-sm">Loading…</span>
    </div>
  )

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
      {deps.map((dep) => (
        <div key={dep.name} className="flex items-center justify-between py-1 border-b border-border/30 last:border-0">
          <span className="text-xs text-foreground font-mono">{dep.name}</span>
          <span className="text-xs text-muted-foreground font-mono">{dep.version}</span>
        </div>
      ))}
    </div>
  )
}

// ── About tab ─────────────────────────────────────────────────────────────

function AboutTab() {
  const [logoKey] = useState(0)
  const [depsCount, setDepsCount] = useState<number | null>(null)
  const [changelogCount, setChangelogCount] = useState<number | null>(null)
  const [notesOpen, setNotesOpen] = useState(true)
  const [depsOpen, setDepsOpen] = useState(false)

  useEffect(() => {
    fetch("/api/about")
      .then((r) => r.ok ? r.json() : null)
      .then((d: { dependencies: Dependency[] } | null) => { if (d) setDepsCount(d.dependencies.length) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch("/api/changelog")
      .then((r) => r.ok ? r.text() : null)
      .then((raw) => {
        if (!raw) return
        const v = parseChangelog(raw)
        setChangelogCount(v.reduce((s, vv) => s + allEntries(vv).length, 0))
      })
      .catch(() => {})
  }, [])

  return (
    <div className="space-y-6">
      {/* App identity */}
      <div className="flex flex-col items-center py-8 gap-4">
        <div className="h-20 w-20 rounded-xl overflow-hidden border border-border/50 shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/logo?v=${logoKey}`} alt="LUX Logo" className="h-full w-full object-contain" />
        </div>
        <div className="text-center space-y-1">
          <h2 className="text-lg font-semibold">Ludus UX (LUX)</h2>
          <p className="text-sm text-muted-foreground">Cyber Range Manager</p>
          <div className="flex items-center justify-center gap-2 pt-1">
            <Badge variant="outline" className="font-mono text-xs">v{APP_VERSION}</Badge>
            <Badge variant="secondary" className="text-xs">{APP_VERSION_LABEL}</Badge>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground/70">
          <a
            href="https://github.com/ryokubaka/ludus-ux"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-primary transition-colors"
          >
            GitHub
          </a>
          <span>·</span>
          <span>Apache 2.0</span>
          <span>·</span>
          <a
            href="https://docs.ludus.cloud"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-primary transition-colors"
          >
            Ludus Docs
          </a>
        </div>
      </div>

      {/* Release notes */}
      <div className="rounded-lg border border-border bg-card">
        <button
          type="button"
          className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/30 transition-colors rounded-t-lg"
          onClick={() => setNotesOpen((o) => !o)}
        >
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Release notes</span>
          </div>
          <div className="flex items-center gap-2">
            {changelogCount != null && (
              <Badge variant="secondary" className="text-xs h-5">{changelogCount}</Badge>
            )}
            <ChevronRight className={`h-4 w-4 text-muted-foreground/60 transition-transform ${notesOpen ? "rotate-90" : ""}`} />
          </div>
        </button>
        {notesOpen && (
          <div className="px-4 pb-4 border-t border-border/50 pt-3">
            <ReleaseNotes />
          </div>
        )}
      </div>

      {/* Dependencies */}
      <div className="rounded-lg border border-border bg-card">
        <button
          type="button"
          className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/30 transition-colors rounded-t-lg"
          onClick={() => setDepsOpen((o) => !o)}
        >
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Dependencies</span>
          </div>
          <div className="flex items-center gap-2">
            {depsCount != null && (
              <Badge variant="secondary" className="text-xs h-5">{depsCount}</Badge>
            )}
            <ChevronRight className={`h-4 w-4 text-muted-foreground/60 transition-transform ${depsOpen ? "rotate-90" : ""}`} />
          </div>
        </button>
        {depsOpen && (
          <div className="px-4 pb-4 border-t border-border/50 pt-3">
            <DependenciesList />
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main settings page ─────────────────────────────────────────────────────

function SettingsContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const activeTab = searchParams.get("tab") ?? "general"
  const { toast } = useToast()

  const [settings, setSettings] = useState<Settings | null>(null)
  const [draft, setDraft] = useState<Settings | null>(null)
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; version?: string } | null>(null)
  const [credentialTesting, setCredentialTesting] = useState(false)
  const [credentialTestResult, setCredentialTestResult] = useState<{
    rootSsh: {
      ok: boolean; host: string; port: number; user: string
      authAttempted: string; privateKeyPath: string | null; detail?: string
    }
    adminApi: { ok: boolean; baseUrl: string; detail?: string; hint?: string }
    keyProbe?: {
      env: { PROXMOX_SSH_KEY_PATH?: string; GOAD_SSH_KEY_PATH?: string }
      settingsKeyPath: string; effectiveKeyPath?: string
      sshDirListing: string[] | null; sshDirError?: string
      sshDirEntries?: Array<{
        nameJson: string; path: string; exists: boolean
        isSymlink?: boolean; linkTarget?: string; danglingSymlink?: boolean
        isFile: boolean; size: number; readable: boolean; readError?: string
      }> | null
      candidates: Array<{
        path: string; exists: boolean; isSymlink?: boolean; linkTarget?: string
        danglingSymlink?: boolean; isFile: boolean; size: number; readable: boolean; readError?: string
      }>
      firstReadablePath: string | null
    }
  } | null>(null)
  const [showSshPassword, setShowSshPassword] = useState(false)
  const [hasLogo, setHasLogo] = useState(false)
  const [logoKey, setLogoKey] = useState(0)
  const [logoUploading, setLogoUploading] = useState(false)
  const [logoDeleting, setLogoDeleting] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch("/api/settings").then((r) => r.ok ? r.json() : null),
      fetch("/api/auth/session").then((r) => r.ok ? r.json() : null),
    ]).then(([s, sess]) => {
      if (s) { setSettings(s); setDraft(s) }
      if (sess?.authenticated) setSession({ username: sess.username, isAdmin: sess.isAdmin })
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    fetch("/api/logo", { method: "HEAD" })
      .then((r) => setHasLogo(r.status === 200))
      .catch(() => setHasLogo(false))
  }, [logoKey])

  const isDirty = draft && settings && JSON.stringify(draft) !== JSON.stringify(settings)

  const handleSave = async () => {
    if (!draft) return
    setSaving(true)
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ variant: "destructive", title: "Error", description: data.error })
      } else {
        setSettings(data); setDraft(data)
        toast({
          title: "Settings saved",
          description:
            "Applied immediately and persisted to SQLite—they survive container restarts and override matching .env defaults.",
        })
      }
    } catch {
      toast({ variant: "destructive", title: "Save failed" })
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true); setTestResult(null)
    const result = await ludusApi.getVersion()
    if (result.data?.result) {
      setTestResult({ success: true, message: "Connected to Ludus server", version: result.data.result })
    } else {
      setTestResult({ success: false, message: result.error || "Could not connect" })
    }
    setTesting(false)
  }

  const handleTestCredentials = async () => {
    if (!draft || !session?.isAdmin) return
    setCredentialTesting(true); setCredentialTestResult(null)
    try {
      const res = await fetch("/api/settings/test-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ludusUrl: draft.ludusUrl, ludusAdminUrl: draft.ludusAdminUrl,
          sshHost: draft.sshHost, sshPort: draft.sshPort,
          proxmoxSshUser: draft.proxmoxSshUser, proxmoxSshPassword: draft.proxmoxSshPassword,
          proxmoxSshKeyPath: draft.proxmoxSshKeyPath,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast({ variant: "destructive", title: "Credential test failed", description: typeof data?.error === "string" ? data.error : res.statusText })
      } else if (data?.rootSsh && data?.adminApi) {
        setCredentialTestResult(data)
      } else {
        toast({ variant: "destructive", title: "Invalid test response" })
      }
    } catch (e) {
      toast({ variant: "destructive", title: "Credential test failed", description: e instanceof Error ? e.message : "Network error" })
    } finally {
      setCredentialTesting(false)
    }
  }

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoUploading(true)
    const form = new FormData()
    form.append("logo", file)
    const res = await fetch("/api/logo", { method: "POST", body: form })
    if (res.ok) {
      setLogoKey((k) => k + 1); setHasLogo(true)
      window.dispatchEvent(new Event("logo-updated"))
      toast({ title: "Logo updated", description: "The new logo is live in the sidebar." })
    } else {
      const d = await res.json().catch(() => ({})) as { error?: string }
      toast({ variant: "destructive", title: "Upload failed", description: d.error })
    }
    setLogoUploading(false); e.target.value = ""
  }

  const handleLogoDelete = async () => {
    setLogoDeleting(true)
    const res = await fetch("/api/logo", { method: "DELETE" })
    if (res.ok) {
      setLogoKey((k) => k + 1); setHasLogo(false)
      window.dispatchEvent(new Event("logo-updated"))
      toast({ title: "Logo removed", description: "The default logo is restored." })
    } else {
      toast({ variant: "destructive", title: "Delete failed" })
    }
    setLogoDeleting(false)
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const tabs = [
    { value: "general", label: "General" },
    { value: "ssh", label: "SSH & GOAD" },
    ...(session?.isAdmin ? [{ value: "branding", label: "Branding" }] : []),
    { value: "about", label: "About" },
  ]

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center gap-3 border-b border-border pb-5">
        <div>
          <h1 className="text-xl font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Configure LUX connection, integrations, and preferences</p>
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(v) => router.push(`/settings?tab=${v}`)}
        className="space-y-6"
      >
        <TabsList className="h-9 p-1 bg-muted/50 border border-border/50">
          {tabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="text-xs px-3 h-7">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ── General ─────────────────────────────────────────────────── */}
        <TabsContent value="general" className="space-y-4 mt-0">
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Values saved here apply <strong>immediately</strong> and are stored in SQLite on your mounted data volume (
              <code className="text-primary">ludus-ux.db</code>). They <strong>persist across container restarts</strong> and
              override matching variables from <code className="text-primary">.env</code> at runtime. Keep{" "}
              <code className="text-primary">.env</code> aligned if you rely on it for fresh installs or automation before the DB is seeded.
            </AlertDescription>
          </Alert>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4 text-primary" />
                  <CardTitle className="text-base">Ludus Server</CardTitle>
                </div>
                <Button size="sm" variant="outline" onClick={handleTest} disabled={testing}>
                  {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Test Connection
                </Button>
              </div>
              <CardDescription>
                REST API and admin endpoint configuration. &quot;Test Connection&quot; only checks the main Ludus API (port 8080).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {testResult && (
                <Alert variant={testResult.success ? "success" : "destructive"}>
                  <div className="flex items-center gap-2">
                    {testResult.success ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                    <AlertDescription>
                      {testResult.message}
                      {testResult.version && <code className="ml-2 text-xs">{testResult.version}</code>}
                    </AlertDescription>
                  </div>
                </Alert>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="ludus-url">
                  Ludus Server URL
                  <span className="ml-2 text-xs text-muted-foreground font-normal">LUDUS_URL</span>
                </Label>
                <Input id="ludus-url" value={draft?.ludusUrl || ""} onChange={(e) => setDraft((d) => d ? { ...d, ludusUrl: e.target.value } : d)} disabled={!session?.isAdmin} className="font-mono text-xs" placeholder="https://192.168.1.1:8080" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="admin-url">
                  Admin API URL
                  <span className="ml-2 text-xs text-muted-foreground font-normal">LUDUS_ADMIN_URL</span>
                </Label>
                <Input id="admin-url" value={draft?.ludusAdminUrl || ""} onChange={(e) => setDraft((d) => d ? { ...d, ludusAdminUrl: e.target.value } : d)} disabled={!session?.isAdmin} className="font-mono text-xs" placeholder="https://your-ludus-host:8081" />
                <p className="text-xs text-muted-foreground">
                  User/group admin calls use Ludus port <strong>8081</strong>. Use{" "}
                  <code className="text-primary">https://127.0.0.1:18081</code> only when relying on the optional SSH tunnel.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="root-api-key">
                  ROOT API Key
                  <span className="ml-2 text-xs text-muted-foreground font-normal">LUDUS_ROOT_API_KEY</span>
                </Label>
                <Input id="root-api-key" type="password" value={draft?.rootApiKey || ""} onChange={(e) => setDraft((d) => d ? { ...d, rootApiKey: e.target.value } : d)} disabled={!session?.isAdmin} className="font-mono text-xs" placeholder="ROOT.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
                <p className="text-xs text-muted-foreground">
                  Required for user/group management. Found at{" "}
                  <code className="text-primary">/opt/ludus/install/root-api-key</code> on the server.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={draft?.verifyTls ?? false} onCheckedChange={(v) => setDraft((d) => d ? { ...d, verifyTls: v } : d)} disabled={!session?.isAdmin} />
                <div>
                  <Label>Verify TLS Certificate</Label>
                  <p className="text-xs text-muted-foreground">Disable for self-signed certs (typical Ludus installation)</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {isDirty && (
            <div className="flex justify-end">
              <Button onClick={handleSave} disabled={saving} size="sm" className="gap-2">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save Changes
              </Button>
            </div>
          )}
        </TabsContent>

        {/* ── SSH & GOAD ──────────────────────────────────────────────── */}
        <TabsContent value="ssh" className="space-y-4 mt-0">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-green-400" />
                <CardTitle className="text-base">SSH &amp; GOAD Integration</CardTitle>
              </div>
              <CardDescription>SSH server used for user login and GOAD command execution</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">GOAD Integration</p>
                  <p className="text-xs text-muted-foreground">
                    Show or hide GOAD in the sidebar. Set <code className="text-primary">ENABLE_GOAD=false</code> in <code className="text-primary">.env</code> to disable permanently.
                  </p>
                </div>
                <Switch checked={draft?.goadEnabled ?? true} onCheckedChange={(v) => setDraft((d) => d ? { ...d, goadEnabled: v } : d)} disabled={!session?.isAdmin} />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2 space-y-1.5">
                  <Label htmlFor="ssh-host">
                    SSH Host
                    <span className="ml-2 text-xs text-muted-foreground font-normal">LUDUS_SSH_HOST</span>
                  </Label>
                  <Input id="ssh-host" value={draft?.sshHost || ""} onChange={(e) => setDraft((d) => d ? { ...d, sshHost: e.target.value } : d)} disabled={!session?.isAdmin} className="font-mono text-xs" placeholder="192.168.1.1" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ssh-port">Port</Label>
                  <Input id="ssh-port" type="number" value={draft?.sshPort || 22} onChange={(e) => setDraft((d) => d ? { ...d, sshPort: parseInt(e.target.value) || 22 } : d)} disabled={!session?.isAdmin} className="font-mono text-xs" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="goad-path">
                  GOAD Installation Path
                  <span className="ml-2 text-xs text-muted-foreground font-normal">GOAD_PATH</span>
                </Label>
                <Input id="goad-path" value={draft?.goadPath || ""} onChange={(e) => setDraft((d) => d ? { ...d, goadPath: e.target.value } : d)} disabled={!session?.isAdmin} className="font-mono text-xs" placeholder="/opt/goad-mod" />
              </div>

              <div className="border-t border-border pt-4 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Root SSH Credentials</p>
                <p className="text-xs text-muted-foreground">
                  Used for privileged admin operations: pvesh over SSH, user password changes, and API key updates.
                  GOAD runs as each user&apos;s own SSH session — root creds here are not used for normal GOAD.
                </p>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="ssh-user">
                      SSH User
                      <span className="ml-2 text-xs text-muted-foreground font-normal">PROXMOX_SSH_USER</span>
                    </Label>
                    <Input id="ssh-user" value={draft?.proxmoxSshUser || ""} onChange={(e) => setDraft((d) => d ? { ...d, proxmoxSshUser: e.target.value } : d)} disabled={!session?.isAdmin} className="font-mono text-xs" placeholder="root" />
                  </div>
                  <div className="col-span-2 space-y-1.5">
                    <Label htmlFor="ssh-password">
                      SSH Password
                      <span className="ml-2 text-xs text-muted-foreground font-normal">PROXMOX_SSH_PASSWORD</span>
                    </Label>
                    <div className="flex gap-2">
                      <Input id="ssh-password" type={showSshPassword ? "text" : "password"} value={draft?.proxmoxSshPassword || ""} onChange={(e) => setDraft((d) => d ? { ...d, proxmoxSshPassword: e.target.value } : d)} disabled={!session?.isAdmin} className="font-mono text-xs flex-1" placeholder="Leave blank to use SSH key" />
                      <Button type="button" size="icon" variant="ghost" onClick={() => setShowSshPassword(!showSshPassword)} disabled={!session?.isAdmin}>
                        {showSshPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      If blank, LUX uses <code className="text-primary">PROXMOX_SSH_KEY_PATH</code> or{" "}
                      <code className="text-primary">GOAD_SSH_KEY_PATH</code> (default <code className="text-primary">/app/ssh/id_rsa</code>).
                    </p>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ssh-key-path">
                    Private key path (in container)
                    <span className="ml-2 text-xs text-muted-foreground font-normal">saved in SQLite</span>
                  </Label>
                  <Input id="ssh-key-path" value={draft?.proxmoxSshKeyPath || ""} onChange={(e) => setDraft((d) => d ? { ...d, proxmoxSshKeyPath: e.target.value } : d)} disabled={!session?.isAdmin} className="font-mono text-xs" placeholder="/app/ssh/id_rsa (optional; overrides env search order)" />
                </div>
                {session?.isAdmin && (
                  <div className="space-y-3">
                    <Button type="button" size="sm" variant="secondary" onClick={handleTestCredentials} disabled={credentialTesting} className="gap-2">
                      {credentialTesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                      Test root SSH &amp; admin API
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      Runs from the app container using the values in this form. Confirms root SSH and admin API reachability.
                    </p>
                    {credentialTestResult && (
                      <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3 text-xs">
                        <div className="flex items-start gap-2">
                          {credentialTestResult.rootSsh.ok
                            ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500 mt-0.5" />
                            : <XCircle className="h-4 w-4 shrink-0 text-destructive mt-0.5" />}
                          <div>
                            <p className="font-semibold">Root SSH → {credentialTestResult.rootSsh.host}:{credentialTestResult.rootSsh.port} ({credentialTestResult.rootSsh.user})</p>
                            <p className="text-muted-foreground">
                              Auth: <code className="text-primary">{credentialTestResult.rootSsh.authAttempted}</code>
                              {credentialTestResult.rootSsh.privateKeyPath && <> · key: <code className="text-primary">{credentialTestResult.rootSsh.privateKeyPath}</code></>}
                            </p>
                            {credentialTestResult.rootSsh.detail && <p className="mt-1 text-foreground/90 whitespace-pre-wrap break-words">{credentialTestResult.rootSsh.detail}</p>}
                            {credentialTestResult.keyProbe && (
                              <div className="mt-2 rounded border border-border/80 bg-background/50 p-2 space-y-1.5 font-mono text-[11px]">
                                <p className="font-sans font-semibold text-foreground">SSH key probe</p>
                                <p className="text-muted-foreground break-all">SQLite path: {JSON.stringify(credentialTestResult.keyProbe.settingsKeyPath)}</p>
                                <p className="text-muted-foreground break-all">
                                  PROXMOX_SSH_KEY_PATH={JSON.stringify(credentialTestResult.keyProbe.env.PROXMOX_SSH_KEY_PATH ?? "")}{" "}
                                  GOAD_SSH_KEY_PATH={JSON.stringify(credentialTestResult.keyProbe.env.GOAD_SSH_KEY_PATH ?? "")}
                                </p>
                                {credentialTestResult.keyProbe.sshDirError
                                  ? <p className="text-amber-600 dark:text-amber-400">{credentialTestResult.keyProbe.sshDirError}</p>
                                  : credentialTestResult.keyProbe.sshDirListing?.length
                                    ? <p className="text-muted-foreground">/app/ssh: {credentialTestResult.keyProbe.sshDirListing.join(", ")}</p>
                                    : <p className="text-muted-foreground">/app/ssh: (empty or unreadable)</p>
                                }
                                {credentialTestResult.keyProbe.sshDirEntries && credentialTestResult.keyProbe.sshDirEntries.length > 0 && (
                                  <ul className="list-none space-y-1 pl-0">
                                    {credentialTestResult.keyProbe.sshDirEntries.map((e) => (
                                      <li key={e.path} className="break-all">
                                        name={e.nameJson} → {e.path}: exists={String(e.exists)}{e.isSymlink ? ` symlink→${JSON.stringify(e.linkTarget ?? "")}` : ""}{e.danglingSymlink ? " DANGLING" : ""} size={e.size} readable={String(e.readable)}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                                <p className="text-muted-foreground">First readable: <span className="text-foreground">{credentialTestResult.keyProbe.firstReadablePath ?? "none"}</span></p>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-start gap-2 border-t border-border pt-2">
                          {credentialTestResult.adminApi.ok
                            ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500 mt-0.5" />
                            : <XCircle className="h-4 w-4 shrink-0 text-destructive mt-0.5" />}
                          <div>
                            <p className="font-semibold">Admin API</p>
                            <p className="text-muted-foreground break-all"><code className="text-primary">{credentialTestResult.adminApi.baseUrl}</code></p>
                            {credentialTestResult.adminApi.detail && <p className="mt-1 text-foreground/90 whitespace-pre-wrap break-words">{credentialTestResult.adminApi.detail}</p>}
                            {credentialTestResult.adminApi.hint && <p className="mt-1 text-amber-600 dark:text-amber-400 whitespace-pre-wrap break-words">{credentialTestResult.adminApi.hint}</p>}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {isDirty && (
            <div className="flex justify-end">
              <Button onClick={handleSave} disabled={saving} size="sm" className="gap-2">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save Changes
              </Button>
            </div>
          )}
        </TabsContent>

        {/* ── Branding ────────────────────────────────────────────────── */}
        {session?.isAdmin && (
          <TabsContent value="branding" className="space-y-4 mt-0">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <ImageIcon className="h-4 w-4 text-purple-400" />
                  <CardTitle className="text-base">Branding</CardTitle>
                </div>
                <CardDescription>
                  Custom logo shown in the sidebar. Stored in <code className="text-primary">data/uploads/</code> and persists across container restarts.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-6">
                  <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-border bg-muted/30 overflow-hidden flex-shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/logo?v=${logoKey}`} alt="Current logo" className="h-full w-full object-contain" />
                  </div>
                  <div className="space-y-2 flex-1">
                    <p className="text-xs text-muted-foreground">
                      {hasLogo ? "Custom logo is set." : "Using default logo."}{" "}
                      Supported formats: PNG, JPG, GIF, WebP, SVG.
                    </p>
                    <div className="flex gap-2">
                      <label className="cursor-pointer">
                        <input type="file" accept=".png,.jpg,.jpeg,.gif,.webp,.svg" className="sr-only" onChange={handleLogoUpload} disabled={logoUploading} />
                        <span className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer select-none">
                          {logoUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                          {hasLogo ? "Replace Logo" : "Upload Logo"}
                        </span>
                      </label>
                      {hasLogo && (
                        <Button size="sm" variant="ghost" onClick={handleLogoDelete} disabled={logoDeleting} className="text-destructive hover:text-destructive gap-1.5">
                          {logoDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          Remove
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* ── About ────────────────────────────────────────────────────── */}
        <TabsContent value="about" className="mt-0">
          <AboutTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default function SettingsPage() {
  return (
    <Suspense fallback={
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    }>
      <SettingsContent />
    </Suspense>
  )
}
