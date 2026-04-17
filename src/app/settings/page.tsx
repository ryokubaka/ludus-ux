"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Server,
  Terminal,
  AlertTriangle,
  RefreshCw,
  Save,
  Info,
  Eye,
  EyeOff,
  KeyRound,
  ImageIcon,
  Upload,
  Trash2,
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { ludusApi } from "@/lib/api"

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
  /** Path inside the container (e.g. /app/ssh/id_rsa); persisted in SQLite. */
  proxmoxSshKeyPath?: string
}

interface SessionInfo {
  username: string
  isAdmin: boolean
}

export default function SettingsPage() {
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
      ok: boolean
      host: string
      port: number
      user: string
      authAttempted: string
      privateKeyPath: string | null
      detail?: string
    }
    adminApi: { ok: boolean; baseUrl: string; detail?: string; hint?: string }
    keyProbe?: {
      env: { PROXMOX_SSH_KEY_PATH?: string; GOAD_SSH_KEY_PATH?: string }
      settingsKeyPath: string
      effectiveKeyPath?: string
      sshDirListing: string[] | null
      sshDirError?: string
      sshDirEntries?: Array<{
        nameJson: string
        path: string
        exists: boolean
        isSymlink?: boolean
        linkTarget?: string
        danglingSymlink?: boolean
        isFile: boolean
        size: number
        readable: boolean
        readError?: string
      }> | null
      candidates: Array<{
        path: string
        exists: boolean
        isSymlink?: boolean
        linkTarget?: string
        danglingSymlink?: boolean
        isFile: boolean
        size: number
        readable: boolean
        readError?: string
      }>
      firstReadablePath: string | null
    }
  } | null>(null)

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
        setSettings(data)
        setDraft(data)
        toast({ title: "Settings saved", description: "Changes are active until the container restarts." })
      }
    } catch {
      toast({ variant: "destructive", title: "Save failed" })
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
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
    setCredentialTesting(true)
    setCredentialTestResult(null)
    try {
      const res = await fetch("/api/settings/test-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ludusUrl: draft.ludusUrl,
          ludusAdminUrl: draft.ludusAdminUrl,
          sshHost: draft.sshHost,
          sshPort: draft.sshPort,
          proxmoxSshUser: draft.proxmoxSshUser,
          proxmoxSshPassword: draft.proxmoxSshPassword,
          proxmoxSshKeyPath: draft.proxmoxSshKeyPath,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast({
          variant: "destructive",
          title: "Credential test failed",
          description: typeof data?.error === "string" ? data.error : res.statusText,
        })
      } else if (data?.rootSsh && data?.adminApi) {
        setCredentialTestResult(data)
      } else {
        toast({ variant: "destructive", title: "Invalid test response" })
      }
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Credential test failed",
        description: e instanceof Error ? e.message : "Network error",
      })
    } finally {
      setCredentialTesting(false)
    }
  }

  const [showSshPassword, setShowSshPassword] = useState(false)
  const isDirty = draft && settings && JSON.stringify(draft) !== JSON.stringify(settings)

  // Logo management state
  const [hasLogo, setHasLogo] = useState(false)
  const [logoKey, setLogoKey] = useState(0)
  const [logoUploading, setLogoUploading] = useState(false)
  const [logoDeleting, setLogoDeleting] = useState(false)

  useEffect(() => {
    fetch("/api/logo", { method: "HEAD" })
      .then((r) => setHasLogo(r.status === 200))
      .catch(() => setHasLogo(false))
  }, [logoKey])

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoUploading(true)
    const form = new FormData()
    form.append("logo", file)
    const res = await fetch("/api/logo", { method: "POST", body: form })
    if (res.ok) {
      setLogoKey((k) => k + 1)
      setHasLogo(true)
      window.dispatchEvent(new Event("logo-updated"))
      toast({ title: "Logo updated", description: "The new logo is live in the sidebar." })
    } else {
      const d = await res.json().catch(() => ({}))
      toast({ variant: "destructive", title: "Upload failed", description: d.error })
    }
    setLogoUploading(false)
    e.target.value = ""
  }

  const handleLogoDelete = async () => {
    setLogoDeleting(true)
    const res = await fetch("/api/logo", { method: "DELETE" })
    if (res.ok) {
      setLogoKey((k) => k + 1)
      setHasLogo(false)
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

  return (
    <div className="max-w-3xl space-y-6">
      {/* Persistence warning */}
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription className="text-xs">
          Settings changed here are <strong>active immediately</strong> but are <strong>reset on container restart</strong>.
          To persist changes permanently, update your <code className="text-primary">.env</code> file and run{" "}
          <code className="text-primary">docker-compose up -d</code>.
        </AlertDescription>
      </Alert>

      {/* Ludus Server */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Server className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Ludus Server</CardTitle>
            </div>
            <Button size="sm" variant="outline" onClick={handleTest} disabled={testing}>
              {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Test Connection
            </Button>
          </div>
          <CardDescription>
            REST API and admin endpoint configuration. &quot;Test Connection&quot; only checks the main Ludus API (port 8080).
            Use <strong>Test root SSH &amp; admin API</strong> below for user management / tunnel diagnostics.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {testResult && (
            <Alert variant={testResult.success ? "success" : "destructive"}>
              <div className="flex items-center gap-2">
                {testResult.success
                  ? <CheckCircle2 className="h-4 w-4" />
                  : <XCircle className="h-4 w-4" />}
                <AlertDescription>
                  {testResult.message}
                  {testResult.version && (
                    <code className="ml-2 text-xs">{testResult.version}</code>
                  )}
                </AlertDescription>
              </div>
            </Alert>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="ludus-url">
              Ludus Server URL
              <span className="ml-2 text-xs text-muted-foreground font-normal">LUDUS_URL</span>
            </Label>
            <Input
              id="ludus-url"
              value={draft?.ludusUrl || ""}
              onChange={(e) => setDraft((d) => d ? { ...d, ludusUrl: e.target.value } : d)}
              disabled={!session?.isAdmin}
              className="font-mono text-xs"
              placeholder="https://192.168.1.1:8080"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="admin-url">
              Admin API URL
              <span className="ml-2 text-xs text-muted-foreground font-normal">LUDUS_ADMIN_URL</span>
            </Label>
            <Input
              id="admin-url"
              value={draft?.ludusAdminUrl || ""}
              onChange={(e) => setDraft((d) => d ? { ...d, ludusAdminUrl: e.target.value } : d)}
              disabled={!session?.isAdmin}
              className="font-mono text-xs"
              placeholder="https://your-ludus-host:8081"
            />
            <p className="text-xs text-muted-foreground">
              User/group admin calls use Ludus port <strong>8081</strong>. Use{" "}
              <code className="text-primary">https://&lt;host&gt;:8081</code> when the container can reach it (same host
              as <code className="text-primary">LUDUS_URL</code> is typical). Only use{" "}
              <code className="text-primary">https://127.0.0.1:18081</code> when relying on the optional SSH tunnel to
              the server&apos;s loopback 8081.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="root-api-key">
              ROOT API Key
              <span className="ml-2 text-xs text-muted-foreground font-normal">LUDUS_ROOT_API_KEY</span>
            </Label>
            <Input
              id="root-api-key"
              type="password"
              value={draft?.rootApiKey || ""}
              onChange={(e) => setDraft((d) => d ? { ...d, rootApiKey: e.target.value } : d)}
              disabled={!session?.isAdmin}
              className="font-mono text-xs"
              placeholder="ROOT.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            />
            <p className="text-xs text-muted-foreground">
              Required for user/group management in Ludus v2. Found at{" "}
              <code className="text-primary">/opt/ludus/install/root-api-key</code> on the server.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Switch
              checked={draft?.verifyTls ?? false}
              onCheckedChange={(v) => setDraft((d) => d ? { ...d, verifyTls: v } : d)}
              disabled={!session?.isAdmin}
            />
            <div>
              <Label>Verify TLS Certificate</Label>
              <p className="text-xs text-muted-foreground">
                Disable for self-signed certs (typical Ludus installation)
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* SSH / GOAD */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Terminal className="h-5 w-5 text-green-400" />
            <CardTitle className="text-base">SSH &amp; GOAD Integration</CardTitle>
          </div>
          <CardDescription>SSH server used for user login and GOAD command execution</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* GOAD enable/disable toggle */}
          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3">
            <div>
              <p className="text-sm font-medium">GOAD Integration</p>
              <p className="text-xs text-muted-foreground">
                Show or hide the GOAD section in the sidebar and navigation.
                Set <code className="text-primary">ENABLE_GOAD=false</code> in <code className="text-primary">.env</code> to disable permanently.
              </p>
            </div>
            <Switch
              checked={draft?.goadEnabled ?? true}
              onCheckedChange={(v) => setDraft((d) => d ? { ...d, goadEnabled: v } : d)}
              disabled={!session?.isAdmin}
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="ssh-host">
                SSH Host
                <span className="ml-2 text-xs text-muted-foreground font-normal">LUDUS_SSH_HOST</span>
              </Label>
              <Input
                id="ssh-host"
                value={draft?.sshHost || ""}
                onChange={(e) => setDraft((d) => d ? { ...d, sshHost: e.target.value } : d)}
                disabled={!session?.isAdmin}
                className="font-mono text-xs"
                placeholder="192.168.1.1"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ssh-port">Port</Label>
              <Input
                id="ssh-port"
                type="number"
                value={draft?.sshPort || 22}
                onChange={(e) => setDraft((d) => d ? { ...d, sshPort: parseInt(e.target.value) || 22 } : d)}
                disabled={!session?.isAdmin}
                className="font-mono text-xs"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="goad-path">
              GOAD Installation Path
              <span className="ml-2 text-xs text-muted-foreground font-normal">GOAD_PATH</span>
            </Label>
            <Input
              id="goad-path"
              value={draft?.goadPath || ""}
              onChange={(e) => setDraft((d) => d ? { ...d, goadPath: e.target.value } : d)}
              disabled={!session?.isAdmin}
              className="font-mono text-xs"
              placeholder="/opt/goad-mod"
            />
          </div>

          <div className="border-t border-border pt-4 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Root SSH Credentials
            </p>
            <p className="text-xs text-muted-foreground">
              Used for privileged admin operations: pvesh over SSH (SPICE, admin VM tools),
              user password changes, and API key updates. In-browser noVNC still needs a
              Proxmox PAM password (set below or use your login SSH password). GOAD runs as
              each user&apos;s own SSH session — root creds here are not used for normal GOAD.
            </p>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="ssh-user">
                  SSH User
                  <span className="ml-2 text-xs text-muted-foreground font-normal">PROXMOX_SSH_USER</span>
                </Label>
                <Input
                  id="ssh-user"
                  value={draft?.proxmoxSshUser || ""}
                  onChange={(e) => setDraft((d) => d ? { ...d, proxmoxSshUser: e.target.value } : d)}
                  disabled={!session?.isAdmin}
                  className="font-mono text-xs"
                  placeholder="root"
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="ssh-password">
                  SSH Password
                  <span className="ml-2 text-xs text-muted-foreground font-normal">PROXMOX_SSH_PASSWORD</span>
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="ssh-password"
                    type={showSshPassword ? "text" : "password"}
                    value={draft?.proxmoxSshPassword || ""}
                    onChange={(e) => setDraft((d) => d ? { ...d, proxmoxSshPassword: e.target.value } : d)}
                    disabled={!session?.isAdmin}
                    className="font-mono text-xs flex-1"
                    placeholder="Leave blank to use SSH key at /app/ssh/id_rsa"
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => setShowSshPassword(!showSshPassword)}
                    disabled={!session?.isAdmin}
                  >
                    {showSshPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  If blank, LUX uses <code className="text-primary">PROXMOX_SSH_KEY_PATH</code> or{" "}
                  <code className="text-primary">GOAD_SSH_KEY_PATH</code> (default{" "}
                  <code className="text-primary">/app/ssh/id_rsa</code> from the <code className="text-primary">./ssh</code> volume).
                  If this key came from the server&apos;s <code className="text-primary">/root/.ssh/id_rsa</code>, the matching
                  public key must be in <code className="text-primary">authorized_keys</code> on that server — see README section{" "}
                  <strong>Root private key copied from the Ludus server</strong>.
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ssh-key-path">
                Private key path (in container)
                <span className="ml-2 text-xs text-muted-foreground font-normal">saved in SQLite</span>
              </Label>
              <Input
                id="ssh-key-path"
                value={draft?.proxmoxSshKeyPath || ""}
                onChange={(e) => setDraft((d) => (d ? { ...d, proxmoxSshKeyPath: e.target.value } : d))}
                disabled={!session?.isAdmin}
                className="font-mono text-xs"
                placeholder="/app/ssh/id_rsa (optional; overrides env search order)"
              />
              <p className="text-xs text-muted-foreground">
                Set this if env vars are not visible to the app process or your key is not at the default path. Same order as the
                credential test: this field, then <code className="text-primary">PROXMOX_SSH_KEY_PATH</code>, then defaults.
              </p>
            </div>

            {session?.isAdmin && (
              <div className="space-y-3">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={handleTestCredentials}
                  disabled={credentialTesting}
                  className="gap-2"
                >
                  {credentialTesting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <KeyRound className="h-3.5 w-3.5" />
                  )}
                  Test root SSH &amp; admin API
                </Button>
                <p className="text-xs text-muted-foreground">
                  Runs from the app container using the values in this form (saved or not). Confirms root SSH
                  (password or mounted key) and whether your admin API URL responds with your current session API key.
                </p>
                {credentialTestResult && (
                  <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3 text-xs">
                    <div className="flex items-start gap-2">
                      {credentialTestResult.rootSsh.ok ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500 mt-0.5" />
                      ) : (
                        <XCircle className="h-4 w-4 shrink-0 text-destructive mt-0.5" />
                      )}
                      <div>
                        <p className="font-semibold">Root SSH → {credentialTestResult.rootSsh.host}:{credentialTestResult.rootSsh.port} ({credentialTestResult.rootSsh.user})</p>
                        <p className="text-muted-foreground">
                          Auth: <code className="text-primary">{credentialTestResult.rootSsh.authAttempted}</code>
                          {credentialTestResult.rootSsh.privateKeyPath && (
                            <>
                              {" "}
                              · key file: <code className="text-primary">{credentialTestResult.rootSsh.privateKeyPath}</code>
                            </>
                          )}
                        </p>
                        {credentialTestResult.rootSsh.detail && (
                          <p className="mt-1 text-foreground/90 whitespace-pre-wrap break-words">
                            {credentialTestResult.rootSsh.detail}
                          </p>
                        )}
                        {credentialTestResult.keyProbe && (
                          <div className="mt-2 rounded border border-border/80 bg-background/50 p-2 space-y-1.5 font-mono text-[11px]">
                            <p className="font-sans font-semibold text-foreground">SSH key probe (from the app container)</p>
                            <p className="text-muted-foreground break-all">
                              SQLite path: {JSON.stringify(credentialTestResult.keyProbe.settingsKeyPath)}
                              {credentialTestResult.keyProbe.effectiveKeyPath != null && credentialTestResult.keyProbe.effectiveKeyPath !== "" && (
                                <> · form override: {JSON.stringify(credentialTestResult.keyProbe.effectiveKeyPath)}</>
                              )}
                            </p>
                            <p className="text-muted-foreground break-all">
                              PROXMOX_SSH_KEY_PATH={JSON.stringify(credentialTestResult.keyProbe.env.PROXMOX_SSH_KEY_PATH ?? "")}{" "}
                              GOAD_SSH_KEY_PATH={JSON.stringify(credentialTestResult.keyProbe.env.GOAD_SSH_KEY_PATH ?? "")}
                            </p>
                            {credentialTestResult.keyProbe.sshDirError ? (
                              <p className="text-amber-600 dark:text-amber-400 break-words">{credentialTestResult.keyProbe.sshDirError}</p>
                            ) : credentialTestResult.keyProbe.sshDirListing?.length ? (
                              <p className="text-muted-foreground break-words">
                                /app/ssh names: {credentialTestResult.keyProbe.sshDirListing.join(", ")}
                              </p>
                            ) : (
                              <p className="text-muted-foreground">/app/ssh: (empty or unreadable)</p>
                            )}
                            {credentialTestResult.keyProbe.sshDirEntries &&
                              credentialTestResult.keyProbe.sshDirEntries.length > 0 && (
                                <div className="space-y-1">
                                  <p className="font-sans text-foreground">Per-file (exact readdir name as JSON):</p>
                                  <ul className="list-none space-y-1 pl-0">
                                    {credentialTestResult.keyProbe.sshDirEntries.map((e) => (
                                      <li key={e.path} className="break-all">
                                        name={e.nameJson} → {e.path}: exists={String(e.exists)}
                                        {e.isSymlink ? ` symlink→${JSON.stringify(e.linkTarget ?? "")}` : ""}
                                        {e.danglingSymlink ? " DANGLING" : ""} file={String(e.isFile)} size={e.size}{" "}
                                        readable={String(e.readable)}
                                        {e.readError ? ` err=${e.readError}` : ""}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            <p className="text-muted-foreground">
                              First readable candidate:{" "}
                              <span className="text-foreground">
                                {credentialTestResult.keyProbe.firstReadablePath ?? "none"}
                              </span>
                            </p>
                            <ul className="list-none space-y-0.5 pl-0">
                              {credentialTestResult.keyProbe.candidates.map((c) => (
                                <li key={c.path} className="break-all">
                                  {c.path}: exists={String(c.exists)}
                                  {c.isSymlink ? ` symlink→${JSON.stringify(c.linkTarget ?? "")}` : ""}
                                  {c.danglingSymlink ? " DANGLING" : ""} file={String(c.isFile)} size={c.size} readable=
                                  {String(c.readable)}
                                  {c.readError ? ` err=${c.readError}` : ""}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-start gap-2 border-t border-border pt-2">
                      {credentialTestResult.adminApi.ok ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500 mt-0.5" />
                      ) : (
                        <XCircle className="h-4 w-4 shrink-0 text-destructive mt-0.5" />
                      )}
                      <div>
                        <p className="font-semibold">Admin API</p>
                        <p className="text-muted-foreground break-all">
                          <code className="text-primary">{credentialTestResult.adminApi.baseUrl}</code>
                        </p>
                        {credentialTestResult.adminApi.detail && (
                          <p className="mt-1 text-foreground/90 whitespace-pre-wrap break-words">
                            {credentialTestResult.adminApi.detail}
                          </p>
                        )}
                        {credentialTestResult.adminApi.hint && (
                          <p className="mt-1 text-amber-600 dark:text-amber-400 whitespace-pre-wrap break-words">
                            {credentialTestResult.adminApi.hint}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Branding (admin only) */}
      {session?.isAdmin && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ImageIcon className="h-5 w-5 text-purple-400" />
              <CardTitle className="text-base">Branding</CardTitle>
            </div>
            <CardDescription>
              Custom logo shown in the sidebar. Stored in <code className="text-primary">data/uploads/</code> and persists across container restarts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-6">
              {/* Preview */}
              <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-border bg-muted/30 overflow-hidden flex-shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/logo?v=${logoKey}`}
                  alt="Current logo"
                  className="h-full w-full object-contain"
                />
              </div>

              <div className="space-y-2 flex-1">
                <p className="text-xs text-muted-foreground">
                  {hasLogo ? "Custom logo is set." : "Using default logo."}{" "}
                  Supported formats: PNG, JPG, GIF, WebP, SVG.
                </p>
                <div className="flex gap-2">
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      accept=".png,.jpg,.jpeg,.gif,.webp,.svg"
                      className="sr-only"
                      onChange={handleLogoUpload}
                      disabled={logoUploading}
                    />
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground cursor-pointer select-none">
                      {logoUploading
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Upload className="h-3.5 w-3.5" />}
                      {hasLogo ? "Replace Logo" : "Upload Logo"}
                    </span>
                  </label>
                  {hasLogo && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10 gap-1.5"
                      onClick={handleLogoDelete}
                      disabled={logoDeleting}
                    >
                      {logoDeleting
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Trash2 className="h-3.5 w-3.5" />}
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Save button (admin only) */}
      {session?.isAdmin ? (
        <div className="flex items-center gap-3">
          <Button
            onClick={handleSave}
            disabled={saving || !isDirty}
            className="gap-2"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? "Saving..." : "Apply Changes"}
          </Button>
          {isDirty && (
            <Badge variant="warning" className="text-xs">Unsaved changes</Badge>
          )}
          {!isDirty && settings && (
            <span className="text-xs text-muted-foreground">No pending changes</span>
          )}
        </div>
      ) : (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Only admin users can modify settings. Log in as <code className="text-primary">root</code> to make changes.
          </AlertDescription>
        </Alert>
      )}

      {/* Session info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your Session</CardTitle>
          <CardDescription>Current login information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Logged in as</span>
            <code className="font-mono text-primary">{session?.username || "—"}</code>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Role</span>
            <Badge variant={session?.isAdmin ? "cyan" : "secondary"} className="text-xs">
              {session?.isAdmin ? "Admin" : "User"}
            </Badge>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">API key source</span>
            <span className="text-xs text-muted-foreground">~/.bashrc on Ludus server</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
