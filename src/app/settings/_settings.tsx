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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
  ShieldAlert,
  Copy,
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { ludusApi } from "@/lib/ui/api"
import { APP_VERSION, APP_VERSION_LABEL } from "@/lib/core/changelog"
import { LudusReleasesPanel } from "@/components/settings/ludus-releases-panel"
import { LuxReleasesPanel } from "@/components/settings/lux-releases-panel"
import { SshHostKeysPanel } from "@/components/settings/ssh-host-keys-panel"
import { useResolvedSession } from "@/hooks/use-resolved-session"
import { useQuery } from "@tanstack/react-query"
import { queryKeys } from "@/lib/ui/query-keys"
import { useEffectiveScopeTag } from "@/lib/session/effective-scope-context"
import { STALE } from "@/lib/ui/query-client"
import { canSubmitLuxHostInstall } from "@/lib/ssh/root-ssh-preflight"
import { ludusMayIgnoreDeployVerboseWhenForce } from "@/lib/ludus/ludus-version"

// ── Types ──────────────────────────────────────────────────────────────────

interface Settings {
  ludusUrl: string
  ludusAdminUrl: string
  sshHost: string
  sshPort: number
  goadPath: string
  ludushoundPath: string
  ludusInstallPath: string
  goadEnabled: boolean
  ludushoundEnabled: boolean
  ludusAnsibleVerbose: boolean
  ludusAnsibleSpeedups: boolean
  useLudusHostDns: boolean
  ignoreChocolateyChecksums: boolean
  /** New value typed by the admin. The server never sends the stored key. */
  rootApiKey?: string
  rootApiKeySet?: boolean
  /** Server: non-empty LUDUS_ROOT_API_KEY env overrides SQLite for the effective key. */
  rootApiKeyOverriddenByEnv?: boolean
  proxmoxSshUser?: string
  /** New value typed by the admin. The server never sends the stored password. */
  proxmoxSshPassword?: string
  proxmoxSshPasswordSet?: boolean
  proxmoxSshKeyPath?: string
}

interface SessionInfo {
  username: string
  isAdmin: boolean
}

function isGitHubRepoUrl(repoUrl: string): boolean {
  try {
    const host = new URL(repoUrl).hostname.toLowerCase()
    return host === "github.com" || host.endsWith(".github.com")
  } catch {
    return false
  }
}

// ── About tab ─────────────────────────────────────────────────────────────

function AboutTab({ isAdmin }: { isAdmin: boolean }) {
  const [logoKey] = useState(0)
  const [repoUrl, setRepoUrl] = useState("")

  useEffect(() => {
    fetch("/api/lux/releases", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { repoUrl?: string } | null) => {
        if (d?.repoUrl) setRepoUrl(d.repoUrl)
      })
      .catch(() => {})
  }, [])

  return (
    <div className="space-y-4">
      <div className="grid gap-x-6 lg:grid-cols-2">
        <LudusReleasesPanel isAdmin={isAdmin} />
        <div className="grid gap-4 lg:row-span-3 lg:[grid-template-rows:subgrid]">
          <div className="flex h-full flex-wrap items-center gap-4 rounded-lg border border-border bg-card px-4 py-3">
            <div className="h-12 w-12 shrink-0 rounded-lg overflow-hidden border border-border/50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/logo?v=${logoKey}`} alt="LUX Logo" className="h-full w-full object-contain" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold">Ludus UX</h2>
                <Badge variant="outline" className="font-mono text-xs">v{APP_VERSION}</Badge>
                {APP_VERSION_LABEL ? (
                  <Badge variant="secondary" className="text-xs">{APP_VERSION_LABEL}</Badge>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">Cyber range manager</p>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
              {repoUrl && (
                <>
                  <a
                    href={repoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-primary transition-colors"
                  >
                    {isGitHubRepoUrl(repoUrl) ? "GitHub" : "Repository"}
                  </a>
                  <span className="text-border">·</span>
                </>
              )}
              <span>Apache 2.0</span>
              <span className="text-border">·</span>
              <a
                href="https://docs.ludus.cloud"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-primary transition-colors"
              >
                Ludus docs
              </a>
            </div>
          </div>
          <LuxReleasesPanel isAdmin={isAdmin} />
        </div>
      </div>
    </div>
  )
}

// ── Main settings page ─────────────────────────────────────────────────────

function SettingsContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { toast } = useToast()
  const resolved = useResolvedSession()
  const session: SessionInfo | null = resolved
    ? { username: resolved.username, isAdmin: resolved.isAdmin }
    : null
  const scopeTag = useEffectiveScopeTag()
  const { data: versionData } = useQuery({
    queryKey: queryKeys.version(scopeTag),
    queryFn: async () => {
      const result = await ludusApi.getVersion()
      if (result.error) throw new Error(result.error)
      return result.data
    },
    staleTime: STALE.long,
  })
  const ludusVersion = versionData ? (versionData.result || versionData.version || "") : ""
  const showVerboseForceQuirk = ludusMayIgnoreDeployVerboseWhenForce(ludusVersion)

  const [settings, setSettings] = useState<Settings | null>(null)
  const [draft, setDraft] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; version?: string } | null>(null)
  const [credentialTesting, setCredentialTesting] = useState(false)
  const [luxHostDialogOpen, setLuxHostDialogOpen] = useState(false)
  const [installingLuxHost, setInstallingLuxHost] = useState(false)
  const [luxHostRootPassword, setLuxHostRootPassword] = useState("")
  const [luxHostMode, setLuxHostMode] = useState<"shell" | "ssh">("shell")
  const [luxHostManual, setLuxHostManual] = useState({ command: "", error: "" })
  useEffect(() => {
    if (!luxHostDialogOpen) return
    const user = draft?.proxmoxSshUser?.trim() ?? ""
    if (!user || user === "root") {
      setLuxHostManual({
        command: "",
        error: "SSH user must be a plain Linux username other than root",
      })
      return
    }
    const ctrl = new AbortController()
    void (async () => {
      try {
        const res = await fetch(`/api/settings/lux-host-command?user=${encodeURIComponent(user)}`, {
          signal: ctrl.signal,
        })
        const body = (await res.json().catch(() => ({}))) as { command?: string; error?: string }
        if (!res.ok) {
          setLuxHostManual({ command: "", error: body.error || "Could not build the install command" })
          return
        }
        setLuxHostManual({ command: body.command || "", error: "" })
      } catch (err) {
        if (ctrl.signal.aborted) return
        setLuxHostManual({
          command: "",
          error: err instanceof Error ? err.message : "Could not build the install command",
        })
      }
    })()
    return () => ctrl.abort()
  }, [luxHostDialogOpen, draft?.proxmoxSshUser])
  const [credentialTestResult, setCredentialTestResult] = useState<{
    rootSsh: {
      ok: boolean; host: string; port: number; user: string
      authAttempted: string; privateKeyPath: string | null; detail?: string
      uid?: number | null; remoteUser?: string | null; privileged?: boolean
      sudo?: boolean | null; sudoAll?: boolean | null; packerDir?: string; packerWritable?: boolean | null
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
  const [confirmPassword, setConfirmPassword] = useState("")
  const [hasLogo, setHasLogo] = useState(false)
  const [logoKey, setLogoKey] = useState(0)
  const [logoUploading, setLogoUploading] = useState(false)
  const [logoDeleting, setLogoDeleting] = useState(false)

  const tabs = useMemo(
    () => [
      { value: "general", label: "General" },
      { value: "ssh", label: "Auth" },
      ...(session?.isAdmin ? [{ value: "branding", label: "Branding" }] : []),
      { value: "about", label: "About" },
    ],
    [session?.isAdmin],
  )

  const activeTabRaw = searchParams.get("tab") ?? "general"

  useEffect(() => {
    if (activeTabRaw === "ludus-performance") {
      router.replace("/admin/performance")
    }
  }, [activeTabRaw, router])

  const activeTab = tabs.some((t) => t.value === activeTabRaw) ? activeTabRaw : "general"

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.ok ? r.json() : null)
      .then((s) => {
        if (s) { setSettings(s); setDraft(s) }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetch("/api/logo", { method: "HEAD" })
      .then((r) => setHasLogo(r.status === 200))
      .catch(() => setHasLogo(false))
  }, [logoKey])

  const isDirty = draft && settings && JSON.stringify(draft) !== JSON.stringify(settings)
  const endpointChanged = !!(
    draft &&
    settings &&
    (draft.ludusUrl !== settings.ludusUrl ||
      draft.ludusAdminUrl !== settings.ludusAdminUrl ||
      draft.sshHost !== settings.sshHost ||
      Number(draft.sshPort) !== Number(settings.sshPort))
  )

  const handleSave = async () => {
    if (!draft) return
    setSaving(true)
    try {
      const payload: Settings & { confirmPassword?: string } = { ...draft }
      if (!payload.rootApiKey?.trim()) delete payload.rootApiKey
      if (!payload.proxmoxSshPassword?.trim()) delete payload.proxmoxSshPassword
      if (endpointChanged) payload.confirmPassword = confirmPassword
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ variant: "destructive", title: "Error", description: data.error })
      } else {
        setConfirmPassword("")
        setSettings(data); setDraft(data)
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("lux-settings-updated"))
        }
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
          proxmoxSshUser: draft.proxmoxSshUser,
          ...(draft.proxmoxSshPassword?.trim() ? { proxmoxSshPassword: draft.proxmoxSshPassword } : {}),
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

  const handleInstallLuxHost = async () => {
    if (!draft || !session?.isAdmin) return
    setInstallingLuxHost(true)
    try {
      const res = await fetch("/api/settings/install-lux-host", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sshHost: draft.sshHost,
          sshPort: draft.sshPort,
          proxmoxSshUser: draft.proxmoxSshUser,
          ...(draft.proxmoxSshPassword?.trim() ? { proxmoxSshPassword: draft.proxmoxSshPassword } : {}),
          rootPassword: luxHostRootPassword,
        }),
      })
      const data = await res.json().catch(() => null) as { error?: string; message?: string } | null
      if (!res.ok) {
        toast({
          variant: "destructive",
          title: "lux-host install failed",
          description: data?.error || res.statusText,
        })
        return
      }
      setLuxHostDialogOpen(false)
      setLuxHostRootPassword("")
      toast({ title: "lux-host installed", description: data?.message || "Passwordless sudo is limited to lux-host." })
      await handleTestCredentials()
    } catch (e) {
      toast({
        variant: "destructive",
        title: "lux-host install failed",
        description: e instanceof Error ? e.message : "Network error",
      })
    } finally {
      setInstallingLuxHost(false)
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

  const handleCopyLuxHostManual = async () => {
    if (!luxHostManual.command) return
    try {
      await navigator.clipboard.writeText(luxHostManual.command)
      toast({ title: "Copied", description: "Paste it into a root shell on the Ludus host and run it." })
    } catch {
      toast({ variant: "destructive", title: "Copy failed" })
    }
  }

  const renderSaveBar = (confirmId: string) => isDirty ? (
    <div className="space-y-3">
      {endpointChanged && (
        <div className="space-y-1.5">
          <Label htmlFor={confirmId}>Current SSH password</Label>
          <Input
            id={confirmId}
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="current-password"
            className="font-mono text-xs"
            placeholder="Required to change the Ludus URL or SSH host"
          />
          <p className="text-xs text-muted-foreground">
            Re-enter the password you used to log in. This confirms the new endpoint before API keys are sent there.
          </p>
        </div>
      )}
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving || (endpointChanged && !confirmPassword)} size="sm" className="gap-2">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save Changes
        </Button>
      </div>
    </div>
  ) : null

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {session && !session.isAdmin && (
        <Alert>
          <ShieldAlert className="h-4 w-4" />
          <AlertDescription className="text-sm">
            Admin permissions are required to edit these fields. If your role recently changed, refresh this page or log out and back in.
          </AlertDescription>
        </Alert>
      )}

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
                <Input id="admin-url" value={draft?.ludusAdminUrl || ""} onChange={(e) => setDraft((d) => d ? { ...d, ludusAdminUrl: e.target.value } : d)} disabled={!session?.isAdmin} className="font-mono text-xs" placeholder="https://127.0.0.1:18081" />
                <p className="text-xs text-muted-foreground">
                  A new Ludus server listens on 127.0.0.1:8081 only. Leave this as https://127.0.0.1:18081 so LUX uses the SSH tunnel it opens at startup. Use https://&lt;ludus-host&gt;:8081 only after that port accepts connections from this container.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="root-api-key">
                  ROOT API Key
                  <span className="ml-2 text-xs text-muted-foreground font-normal">LUDUS_ROOT_API_KEY</span>
                </Label>
                <Input id="root-api-key" type="password" value={draft?.rootApiKey || ""} onChange={(e) => setDraft((d) => d ? { ...d, rootApiKey: e.target.value } : d)} disabled={!session?.isAdmin} className="font-mono text-xs" autoComplete="off" placeholder={draft?.rootApiKeySet ? "Configured — enter a new key to replace it" : "ROOT.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"} />
                <p className="text-xs text-muted-foreground">
                  Required for user/group management. Found at{" "}
                  <code className="text-primary">{draft?.ludusInstallPath || "<LUDUS_INSTALL_PATH>"}/install/root-api-key</code> on the server.
                  LUX also sends this value as the PocketBase password for root@ludus.internal. Ludus sets that password only when it first creates the root user. A valid key can still be rejected there after the key changes, or when that first write did not re-read the key file.
                </p>
                {draft?.rootApiKeyOverriddenByEnv ? (
                  <Alert variant="default" className="mt-2 border-status-warning/40 bg-status-warning/10">
                    <Info className="h-4 w-4 text-status-warning" />
                    <AlertDescription className="text-xs text-amber-100/90">
                      The environment value overrides this field. A 401 means that value does not match the server key.
                    </AlertDescription>
                  </Alert>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Integrations</CardTitle>
              <CardDescription>Sidebar entries and deploy behavior</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">GOAD Integration</p>
                  <p className="text-xs text-muted-foreground">Show GOAD in the sidebar.</p>
                </div>
                <Switch checked={draft?.goadEnabled ?? true} onCheckedChange={(v) => setDraft((d) => d ? { ...d, goadEnabled: v } : d)} disabled={!session?.isAdmin} />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">LudusHound Integration</p>
                  <p className="text-xs text-muted-foreground">Show LudusHound in the sidebar.</p>
                </div>
                <Switch checked={draft?.ludushoundEnabled ?? true} onCheckedChange={(v) => setDraft((d) => d ? { ...d, ludushoundEnabled: v } : d)} disabled={!session?.isAdmin} />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">Ludus Ansible verbose</p>
                  <p className="text-xs text-muted-foreground">
                    Verbose Ansible on deploy.
                    {showVerboseForceQuirk && (
                      <> Ludus ≤2.2.3 may ignore this when force is set{ludusVersion ? ` (${ludusVersion})` : ""}.</>
                    )}
                  </p>
                </div>
                <Switch
                  checked={draft?.ludusAnsibleVerbose ?? true}
                  onCheckedChange={(v) => setDraft((d) => d ? { ...d, ludusAnsibleVerbose: v } : d)}
                  disabled={!session?.isAdmin}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">Ansible speedups</p>
                  <p className="text-xs text-muted-foreground">
                    SSH pipelining and a higher fork count for Ludus and GOAD Ansible (env only, no
                    playbook edits). Turn off if a guest&apos;s sudoers requires a TTY.
                  </p>
                </div>
                <Switch
                  checked={draft?.ludusAnsibleSpeedups ?? true}
                  onCheckedChange={(v) => setDraft((d) => d ? { ...d, ludusAnsibleSpeedups: v } : d)}
                  disabled={!session?.isAdmin}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">Use Ludus host DNS</p>
                  <p className="text-xs text-muted-foreground">
                    Before a deploy, point the router AdGuard template at 192.0.2.254 instead of public DNS.
                  </p>
                </div>
                <Switch
                  checked={draft?.useLudusHostDns ?? false}
                  onCheckedChange={(v) => setDraft((d) => d ? { ...d, useLudusHostDns: v } : d)}
                  disabled={!session?.isAdmin}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">Ignore Chocolatey checksums</p>
                  <p className="text-xs text-muted-foreground">
                    Additional-tools installs skip package checksums on every Ludus deploy, including
                    the CLI. A vendor can replace an installer without publishing a new package, and
                    that mismatch fails the whole install. Saving writes this on the Ludus host.
                    Sysinternals already skips its checksum.
                  </p>
                </div>
                <Switch
                  checked={draft?.ignoreChocolateyChecksums ?? false}
                  onCheckedChange={(v) => setDraft((d) => d ? { ...d, ignoreChocolateyChecksums: v } : d)}
                  disabled={!session?.isAdmin}
                />
              </div>
            </CardContent>
          </Card>

          {renderSaveBar("confirm-ssh-password-general")}
        </TabsContent>

        {/* ── Auth ────────────────────────────────────────────────────── */}
        <TabsContent value="ssh" className="space-y-4 mt-0">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-status-success" />
                <CardTitle className="text-base">Authentication</CardTitle>
              </div>
              <CardDescription>Host SSH account used for login, GOAD, and LudusHound</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
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
              {session?.isAdmin ? <SshHostKeysPanel /> : null}
              <div className="space-y-1.5">
                <Label htmlFor="goad-path">
                  GOAD Installation Path
                  <span className="ml-2 text-xs text-muted-foreground font-normal">GOAD_PATH</span>
                </Label>
                <Input id="goad-path" value={draft?.goadPath || ""} onChange={(e) => setDraft((d) => d ? { ...d, goadPath: e.target.value } : d)} disabled={!session?.isAdmin} className="font-mono text-xs" placeholder="/opt/GOAD" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ludushound-path">
                  LudusHound Installation Path
                  <span className="ml-2 text-xs text-muted-foreground font-normal">LUDUSHOUND_PATH</span>
                </Label>
                <Input id="ludushound-path" value={draft?.ludushoundPath || ""} onChange={(e) => setDraft((d) => d ? { ...d, ludushoundPath: e.target.value } : d)} disabled={!session?.isAdmin} className="font-mono text-xs" placeholder="/opt/LudusHound" />
                <p className="text-xs text-muted-foreground">
                  Clone{" "}
                  <a href="https://github.com/bagelByt3s/LudusHound" target="_blank" rel="noreferrer" className="text-primary underline">
                    bagelByt3s/LudusHound
                  </a>{" "}
                  here; LUX builds the binary and installs the Ansible collection.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ludus-install-path">
                  Ludus Installation Path
                  <span className="ml-2 text-xs text-muted-foreground font-normal">LUDUS_INSTALL_PATH</span>
                </Label>
                <Input id="ludus-install-path" value={draft?.ludusInstallPath || ""} onChange={(e) => setDraft((d) => d ? { ...d, ludusInstallPath: e.target.value } : d)} disabled={!session?.isAdmin} className="font-mono text-xs" placeholder="/opt/ludus" />
              </div>

              <div className="border-t border-border pt-4 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Host SSH Credentials</p>
                <p className="text-xs text-muted-foreground">
                  Root, or an account that can run lux-host. The button below installs that rule.
                  GOAD runs as each user&apos;s own SSH session — these host credentials are not used for normal GOAD.
                </p>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="ssh-user">
                      SSH User
                      <span className="ml-2 text-xs text-muted-foreground font-normal">PROXMOX_SSH_USER</span>
                    </Label>
                    <Input id="ssh-user" value={draft?.proxmoxSshUser || ""} onChange={(e) => setDraft((d) => d ? { ...d, proxmoxSshUser: e.target.value } : d)} disabled={!session?.isAdmin} className="font-mono text-xs" placeholder="root" />
                    {draft?.proxmoxSshUser?.trim() && draft.proxmoxSshUser.trim() !== "root" && (
                      <p className="text-xs text-muted-foreground">
                        {draft.proxmoxSshUser.trim()} is not root. Host writes use <code className="text-primary">sudo -n /usr/local/sbin/lux-host</code>. That rule does not allow every sudo command. Install it here, then run the test.
                      </p>
                    )}
                  </div>
                  <div className="col-span-2 space-y-1.5">
                    <Label htmlFor="ssh-password">
                      SSH Password
                      <span className="ml-2 text-xs text-muted-foreground font-normal">PROXMOX_SSH_PASSWORD</span>
                    </Label>
                    <div className="flex gap-2">
                      <Input id="ssh-password" type={showSshPassword ? "text" : "password"} value={draft?.proxmoxSshPassword || ""} onChange={(e) => setDraft((d) => d ? { ...d, proxmoxSshPassword: e.target.value } : d)} disabled={!session?.isAdmin} className="font-mono text-xs flex-1" autoComplete="off" placeholder={draft?.proxmoxSshPasswordSet ? "Configured — leave blank to keep the saved password" : "Leave blank to use SSH key"} />
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
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="secondary" onClick={handleTestCredentials} disabled={credentialTesting} className="gap-2">
                        {credentialTesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                        Test host SSH &amp; admin API
                      </Button>
                      {draft?.proxmoxSshUser?.trim() && draft.proxmoxSshUser.trim() !== "root" && (
                        <Button type="button" size="sm" variant="outline" onClick={() => setLuxHostDialogOpen(true)} disabled={installingLuxHost} className="gap-2">
                          {installingLuxHost ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldAlert className="h-3.5 w-3.5" />}
                          Install lux-host sudo rule
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Runs from the app container using the values in this form. Confirms this SSH account can do host writes, and that the admin API answers with your session Ludus API key.
                    </p>
                    {credentialTestResult && (
                      <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3 text-xs">
                        <div className="flex items-start gap-2">
                          {credentialTestResult.rootSsh.ok
                            ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500 mt-0.5" />
                            : <XCircle className="h-4 w-4 shrink-0 text-destructive mt-0.5" />}
                          <div>
                            <p className="font-semibold">Host SSH → {credentialTestResult.rootSsh.host}:{credentialTestResult.rootSsh.port} ({credentialTestResult.rootSsh.user})</p>
                            <p className="text-muted-foreground">
                              Auth: <code className="text-primary">{credentialTestResult.rootSsh.authAttempted}</code>
                              {credentialTestResult.rootSsh.privateKeyPath && <> · key: <code className="text-primary">{credentialTestResult.rootSsh.privateKeyPath}</code></>}
                            </p>
                            {credentialTestResult.rootSsh.detail && <p className="mt-1 text-foreground/90 whitespace-pre-wrap break-words">{credentialTestResult.rootSsh.detail}</p>}
                            {credentialTestResult.rootSsh.privileged != null && (
                              <p className="mt-1 text-muted-foreground">
                                uid {credentialTestResult.rootSsh.uid ?? "?"} ({credentialTestResult.rootSsh.remoteUser || credentialTestResult.rootSsh.user})
                                {credentialTestResult.rootSsh.sudo != null && (
                                  <> · sudo -n: {credentialTestResult.rootSsh.sudo ? "yes" : "no"}</>
                                )}
                                {credentialTestResult.rootSsh.packerWritable === false && credentialTestResult.rootSsh.packerDir && (
                                  <> · {credentialTestResult.rootSsh.packerDir} is not writable</>
                                )}
                              </p>
                            )}
                            {credentialTestResult.keyProbe && (
                              <div className="mt-2 rounded border border-border/80 bg-background/50 p-2 space-y-1.5 font-mono text-[11px]">
                                <p className="font-sans font-semibold text-foreground">SSH key probe</p>
                                <p className="text-muted-foreground break-all">SQLite path: {JSON.stringify(credentialTestResult.keyProbe.settingsKeyPath)}</p>
                                <p className="text-muted-foreground break-all">
                                  PROXMOX_SSH_KEY_PATH={JSON.stringify(credentialTestResult.keyProbe.env.PROXMOX_SSH_KEY_PATH ?? "")}{" "}
                                  GOAD_SSH_KEY_PATH={JSON.stringify(credentialTestResult.keyProbe.env.GOAD_SSH_KEY_PATH ?? "")}
                                </p>
                                {credentialTestResult.keyProbe.sshDirError
                                  ? <p className="text-status-warning dark:text-status-warning">{credentialTestResult.keyProbe.sshDirError}</p>
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
                            {credentialTestResult.adminApi.hint && <p className="mt-1 text-status-warning dark:text-status-warning whitespace-pre-wrap break-words">{credentialTestResult.adminApi.hint}</p>}
                          </div>
                        </div>
                      </div>
                    )}
                    <Dialog open={luxHostDialogOpen} onOpenChange={(open) => {
                      if (installingLuxHost) return
                      setLuxHostDialogOpen(open)
                      if (!open) {
                        setLuxHostRootPassword("")
                        setLuxHostMode("shell")
                      }
                    }}>
                      <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] max-w-lg overflow-x-hidden overflow-y-auto">
                        <DialogHeader>
                          <DialogTitle>Install lux-host for {draft?.proxmoxSshUser?.trim() || "this account"}?</DialogTitle>
                          <DialogDescription className="break-words">
                            This writes the helper and a sudoers rule for that helper only. It does not grant every sudo command.
                          </DialogDescription>
                        </DialogHeader>
                        <ul className="list-disc space-y-1.5 break-words pl-5 text-sm text-muted-foreground">
                          <li><span className="font-mono">/usr/local/sbin/lux-host</span> runs a fixed list of host operations as root. It does not run a shell.</li>
                          <li><span className="font-mono">/etc/sudoers.d/lux-host</span> lets {draft?.proxmoxSshUser?.trim() || "this user"} run that helper with <span className="font-mono">sudo -n</span>.</li>
                          <li>Other sudo commands still ask for a password. The helper cannot replace itself.</li>
                        </ul>
                        <div role="radiogroup" aria-label="How to install lux-host" className="grid grid-cols-2 gap-2">
                          <Button
                            type="button"
                            role="radio"
                            aria-checked={luxHostMode === "shell"}
                            variant={luxHostMode === "shell" ? "secondary" : "outline"}
                            className="h-auto flex-col items-start gap-0.5 whitespace-normal px-3 py-2 text-left"
                            onClick={() => setLuxHostMode("shell")}
                          >
                            <span className="text-sm font-medium">Run as root</span>
                            <span className="text-xs font-normal text-muted-foreground">Paste one command in a root shell.</span>
                          </Button>
                          <Button
                            type="button"
                            role="radio"
                            aria-checked={luxHostMode === "ssh"}
                            variant={luxHostMode === "ssh" ? "secondary" : "outline"}
                            className="h-auto flex-col items-start gap-0.5 whitespace-normal px-3 py-2 text-left"
                            onClick={() => setLuxHostMode("ssh")}
                          >
                            <span className="text-sm font-medium">Root SSH password</span>
                            <span className="text-xs font-normal text-muted-foreground">sshd allows root login.</span>
                          </Button>
                        </div>
                        {luxHostMode === "shell" ? (
                          <div className="min-w-0 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-medium">Root shell command</p>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="shrink-0 gap-1.5"
                                onClick={() => { void handleCopyLuxHostManual() }}
                                disabled={!luxHostManual.command}
                              >
                                <Copy className="h-3.5 w-3.5" />
                                Copy
                              </Button>
                            </div>
                            <p className="text-xs text-muted-foreground break-words">
                              Paste this into a root shell on the Ludus host and run it. The block is the whole install.
                            </p>
                            {luxHostManual.error ? (
                              <p className="text-xs text-destructive">{luxHostManual.error}</p>
                            ) : (
                              <pre className="max-h-40 min-w-0 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/30 p-3 font-mono text-[11px] leading-relaxed text-foreground">
                                {luxHostManual.command}
                              </pre>
                            )}
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            <Label htmlFor="lux-host-root-password">Root password</Label>
                            <Input
                              id="lux-host-root-password"
                              type="password"
                              value={luxHostRootPassword}
                              onChange={(e) => setLuxHostRootPassword(e.target.value)}
                              className="font-mono text-xs"
                              placeholder="Ludus host root password"
                              autoComplete="off"
                            />
                            <p className="text-xs text-muted-foreground break-words">
                              LUX logs in as root over SSH, writes the helper and the sudoers rule, and drops the password.
                            </p>
                          </div>
                        )}
                        <DialogFooter>
                          <Button variant="outline" onClick={() => { setLuxHostDialogOpen(false); setLuxHostRootPassword(""); setLuxHostMode("shell") }} disabled={installingLuxHost}>Cancel</Button>
                          {luxHostMode === "ssh" && (
                            <Button
                              onClick={() => { void handleInstallLuxHost() }}
                              disabled={!canSubmitLuxHostInstall({
                                installing: installingLuxHost,
                                sshPassword: draft?.proxmoxSshPassword ?? "",
                                rootPassword: luxHostRootPassword,
                                account: {
                                  user: draft?.proxmoxSshUser ?? "",
                                  host: draft?.sshHost ?? "",
                                  port: draft?.sshPort || 22,
                                },
                                probe: credentialTestResult
                                  ? {
                                      user: credentialTestResult.rootSsh.user,
                                      host: credentialTestResult.rootSsh.host,
                                      port: credentialTestResult.rootSsh.port,
                                      authAttempted: credentialTestResult.rootSsh.authAttempted,
                                      uid: credentialTestResult.rootSsh.uid,
                                      sudo: credentialTestResult.rootSsh.sudo,
                                      sudoAll: credentialTestResult.rootSsh.sudoAll,
                                    }
                                  : null,
                              })}
                            >
                              {installingLuxHost && <Loader2 className="h-4 w-4 animate-spin" />}
                              Install
                            </Button>
                          )}
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {renderSaveBar("confirm-ssh-password-auth")}
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
          <AboutTab isAdmin={!!session?.isAdmin} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

export function SettingsPageClient() {
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
