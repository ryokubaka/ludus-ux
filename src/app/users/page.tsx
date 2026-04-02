"use client"

import { useState, useMemo, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { STALE } from "@/lib/query-client"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Plus,
  Trash2,
  RefreshCw,
  Key,
  Download,
  Shield,
  ShieldOff,
  ShieldCheck,
  User,
  Loader2,
  Eye,
  EyeOff,
  Copy,
  Lock,
  Terminal,
} from "lucide-react"
import { ludusApi } from "@/lib/api"
import type { UserObject, RangeObject } from "@/lib/types"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { saveImpersonation } from "@/lib/impersonation-context"

export default function UsersPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const router = useRouter()

  // ── Impersonation ──────────────────────────────────────────────────────────
  const [impersonateTarget, setImpersonateTarget] = useState<{ userID: string } | null>(null)
  const [impersonateApiKey, setImpersonateApiKey] = useState("")
  const [fetchingKey, setFetchingKey] = useState<string | null>(null)
  const [showImpersonateKey, setShowImpersonateKey] = useState(false)
  const apiKeyInputRef = useRef<HTMLInputElement>(null)

  const startImpersonate = useCallback(async (userID: string) => {
    setFetchingKey(userID)
    try {
      const res = await fetch(`/api/admin/fetch-user-apikey?username=${encodeURIComponent(userID)}`)
      const data = await res.json()
      if (data.apiKey) {
        await saveImpersonation({ username: userID, apiKey: data.apiKey })
        toast({ title: `Now managing as ${userID}` })
        router.push("/")
        return
      }
    } catch { /* SSH unavailable — fall through to manual dialog */ }
    finally { setFetchingKey(null) }
    setImpersonateTarget({ userID })
    setImpersonateApiKey("")
    setShowImpersonateKey(false)
    setTimeout(() => apiKeyInputRef.current?.focus(), 50)
  }, [router, toast])

  const commitImpersonate = async () => {
    if (!impersonateTarget || !impersonateApiKey.trim()) {
      toast({ variant: "destructive", title: "API key required" })
      return
    }
    await saveImpersonation({ username: impersonateTarget.userID, apiKey: impersonateApiKey.trim() })
    toast({ title: `Now managing as ${impersonateTarget.userID}` })
    setImpersonateTarget(null)
    router.push("/")
  }

  // ── Add user ───────────────────────────────────────────────────────────────
  const [addDialog, setAddDialog] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newUserId, setNewUserId] = useState("")
  const [newUserPassword, setNewUserPassword] = useState("")
  const [newUserAdmin, setNewUserAdmin] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)

  /** Ludus/Linux usernames: letters and digits only, must start with a letter (max 32). */
  const sanitizeUserId = (value: string) => {
    let s = value.toLowerCase().replace(/[^a-z0-9]/g, "")
    if (s.length > 32) s = s.slice(0, 32)
    s = s.replace(/^[0-9]+/, "")
    return s
  }

  const USER_ID_PATTERN = /^[a-z][a-z0-9]{0,31}$/

  // ── Delete user ────────────────────────────────────────────────────────────
  const [confirmDelete, setConfirmDelete] = useState<{ userId: string; rangeIds?: string[] } | null>(null)
  const [deleteRange, setDeleteRange] = useState(false)
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null)

  // ── Roll API key ───────────────────────────────────────────────────────────
  const [confirmRoll, setConfirmRoll] = useState<string | null>(null)
  const [apiKeyLoading, setApiKeyLoading] = useState<string | null>(null)
  const [apiKeyResult, setApiKeyResult] = useState<{
    userId: string; key: string; bashrcUpdated: boolean; bashrcError?: string
  } | null>(null)
  const [showApiKey, setShowApiKey] = useState(false)

  // ── Change password ────────────────────────────────────────────────────────
  const [changePwUserId, setChangePwUserId] = useState<string | null>(null)
  const [changePwValue, setChangePwValue] = useState("")
  const [changePwConfirm, setChangePwConfirm] = useState("")
  const [showChangePw, setShowChangePw] = useState(false)
  const [changingPw, setChangingPw] = useState(false)

  // ── Data fetch ─────────────────────────────────────────────────────────────
  const { data: usersData, isLoading: loading } = useQuery({
    queryKey: queryKeys.users(),
    queryFn: async () => {
      const [usersResult, rangesResult] = await Promise.all([
        ludusApi.listAllUsers().catch(() => ludusApi.listUsers()),
        ludusApi.listAllRanges().catch(() => ({ data: undefined, error: "no ranges", status: 0 })),
      ])
      const userList: UserObject[] = usersResult.data
        ? (Array.isArray(usersResult.data) ? usersResult.data : [usersResult.data])
        : []
      const rangeMap: Record<string, string[]> = {}
      if (rangesResult.data && Array.isArray(rangesResult.data)) {
        for (const r of rangesResult.data as RangeObject[]) {
          const uid = (r.userID || r.rangeID?.split("-")[0] || "").toLowerCase()
          if (uid && r.rangeID) {
            if (!rangeMap[uid]) rangeMap[uid] = []
            if (!rangeMap[uid].includes(r.rangeID)) rangeMap[uid].push(r.rangeID)
          }
        }
      }
      return { users: userList, rangeMap }
    },
    staleTime: STALE.long,
  })

  const users = usersData?.users ?? []
  /** ROOT is admin-only; hide from the directory UI. */
  const usersVisible = useMemo(
    () => users.filter((u) => u.userID.toUpperCase() !== "ROOT"),
    [users],
  )
  const rangeMap = useMemo(() => usersData?.rangeMap ?? {}, [usersData])

  const invalidateUsers = () => queryClient.invalidateQueries({ queryKey: queryKeys.users() })

  // ── Add user ───────────────────────────────────────────────────────────────
  const handleAdd = async () => {
    const uid = newUserId.trim()
    if (!uid) return
    if (!USER_ID_PATTERN.test(uid)) {
      toast({
        variant: "destructive",
        title: "Invalid user ID",
        description:
          "Use 1–32 characters: start with a letter, then letters and numbers only (no spaces, dots, or symbols).",
      })
      return
    }
    setAdding(true)

    // Step 1: Create the user account.
    // Pass userId as the `name` field so the Linux home directory matches /home/<userId>.
    const result = await ludusApi.addUser(uid, uid, newUserAdmin)
    if (result.error) {
      toast({ variant: "destructive", title: "Error creating user", description: result.error })
      setAdding(false)
      return
    }

    const notes: string[] = []

    // Step 2: Set the Proxmox/Linux password via SSH chpasswd.
    // POST /user/credentials requires Ludus→Proxmox connectivity which may not always
    // be available; chpasswd works directly on the PAM backend (same for Proxmox PAM realm).
    if (newUserPassword.trim()) {
      try {
        const pwRes = await fetch("/api/users/change-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: uid, newPassword: newUserPassword }),
        })
        const pwData = await pwRes.json() as { success?: boolean; error?: string }
        if (pwData.success) {
          notes.push("password set")
        } else {
          notes.push(`password not set: ${pwData.error || `HTTP ${pwRes.status}`}`)
        }
      } catch (err) {
        notes.push(`password not set: ${(err as Error).message}`)
      }
    }

    // Step 3: Roll/retrieve the API key and write it to ~/.bashrc
    try {
      const keyRes = await fetch("/api/users/roll-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: uid }),
      })
      const keyData = await keyRes.json() as { bashrcUpdated?: boolean; bashrcError?: string }
      if (keyData.bashrcUpdated) {
        notes.push(".bashrc initialized")
      } else if (keyData.bashrcError) {
        notes.push(`bashrc: ${keyData.bashrcError}`)
      }
    } catch {
      // non-fatal
    }

    toast({
      title: "User created",
      description: `${uid}${notes.length ? ` — ${notes.join(", ")}` : ""}`,
    })
    setAddDialog(false)
    setNewUserId(""); setNewUserPassword("")
    setNewUserAdmin(false); setShowNewPassword(false)
    invalidateUsers()
    setAdding(false)
  }

  // ── Delete user ────────────────────────────────────────────────────────────
  const openDeleteDialog = (userId: string) => {
    // Collect all range IDs for this user (they may have multiple in Ludus v2)
    const userRanges = Object.entries(rangeMap)
      .filter(([uid]) => uid.toLowerCase() === userId.toLowerCase())
      .flatMap(([, rids]) => rids)
    setDeleteRange(false)
    setConfirmDelete({ userId, rangeIds: userRanges })
  }

  const handleDelete = async () => {
    if (!confirmDelete) return
    const { userId, rangeIds } = confirmDelete
    setConfirmDelete(null)
    setDeletingUserId(userId)

    const notes: string[] = []

    if (deleteRange) {
      // Delete all non-default ranges explicitly (using rangeID so the correct pool is
      // targeted even when the user has multiple ranges in Ludus v2).
      // The default range is handled atomically by deleteUser(deleteDefaultRange=true).
      const extraRanges = (rangeIds ?? []).filter((rid: string) => {
        // The default range typically has rangeID === userID (Ludus 1:1 default).
        // Extra GOAD ranges have a different rangeID. Delete them explicitly.
        return rid.toLowerCase() !== userId.toLowerCase()
      })

      for (const rid of extraRanges) {
        const r = await ludusApi.deleteUserRange(userId, rid)
        if (r.error) notes.push(`range ${rid} deletion failed: ${r.error}`)
        else notes.push(`range ${rid} deleted`)
      }
    }

    // DELETE /user/{userID}?deleteDefaultRange=true atomically:
    //   1. Removes the user's default range (VMs + Proxmox pool) when requested
    //   2. Removes the user from PocketBase
    //   3. Removes the Proxmox/Linux user account
    const userResult = await ludusApi.deleteUser<{ result?: string }>(userId, deleteRange)
    setDeletingUserId(null)

    if (userResult.error) {
      // Surface the actual deletion error rather than silently ignoring it
      toast({
        variant: "destructive",
        title: "Error deleting user",
        description: `${userId}: ${userResult.error}${notes.length ? ` (${notes.join("; ")})` : ""}`,
      })
      invalidateUsers()
      return
    }

    toast({
      title: "User deleted",
      description: [
        userId,
        userResult.data?.result,
        notes.length ? notes.join("; ") : "",
      ]
        .filter(Boolean)
        .join(" — "),
    })

    invalidateUsers()
  }

  // ── Roll API key ───────────────────────────────────────────────────────────
  const handleRollApiKey = async (userId: string) => {
    setConfirmRoll(null)
    setApiKeyLoading(userId)
    setShowApiKey(false)
    try {
      const res = await fetch("/api/users/roll-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      })
      const data = await res.json() as { newKey?: string; bashrcUpdated?: boolean; bashrcError?: string; error?: string }
      if (!res.ok || data.error) {
        toast({ variant: "destructive", title: "Failed to roll key", description: data.error || `HTTP ${res.status}` })
        return
      }
      setApiKeyResult({ userId, key: data.newKey || "", bashrcUpdated: data.bashrcUpdated ?? false, bashrcError: data.bashrcError })
    } catch (err) {
      toast({ variant: "destructive", title: "Network error", description: (err as Error).message })
    } finally {
      setApiKeyLoading(null)
    }
  }

  // ── Change password ────────────────────────────────────────────────────────
  const handleChangePassword = async () => {
    if (!changePwUserId || !changePwValue.trim()) return
    if (changePwValue !== changePwConfirm) {
      toast({ variant: "destructive", title: "Passwords do not match" })
      return
    }
    setChangingPw(true)
    try {
      const res = await fetch("/api/users/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: changePwUserId, newPassword: changePwValue }),
      })
      const data = await res.json() as { success?: boolean; error?: string }
      if (!res.ok || data.error) {
        toast({ variant: "destructive", title: "Password change failed", description: data.error || `HTTP ${res.status}` })
      } else {
        toast({ title: "Password changed", description: `Password updated for ${changePwUserId}` })
        setChangePwUserId(null)
        setChangePwValue(""); setChangePwConfirm("")
        setShowChangePw(false)
      }
    } catch (err) {
      toast({ variant: "destructive", title: "Network error", description: (err as Error).message })
    } finally {
      setChangingPw(false)
    }
  }

  // ── Promote / demote admin ─────────────────────────────────────────────────
  const [roleChanging, setRoleChanging] = useState<string | null>(null)

  const handleToggleAdmin = async (userID: string, makeAdmin: boolean) => {
    setRoleChanging(userID)
    try {
      const res = await fetch("/api/admin/user-role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userID, isAdmin: makeAdmin }),
      })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok) {
        toast({ variant: "destructive", title: "Role change failed", description: data.error ?? `HTTP ${res.status}` })
        return
      }
      toast({ title: makeAdmin ? `${userID} promoted to admin` : `${userID} demoted to user` })
      invalidateUsers()
    } catch (err) {
      toast({ variant: "destructive", title: "Role change error", description: (err as Error).message })
    } finally {
      setRoleChanging(null)
    }
  }

  // ── WireGuard ──────────────────────────────────────────────────────────────
  const handleGetWireguard = async (userId: string) => {
    const result = await ludusApi.getUserWireguard(userId)
    if (result.error) {
      toast({ variant: "destructive", title: "Error", description: result.error })
    } else {
      const data = result.data as { result?: { wireGuardConfig?: string } } | string
      const content = typeof data === "string"
        ? data
        : (data as { result?: { wireGuardConfig?: string } })?.result?.wireGuardConfig || ""
      const blob = new Blob([content], { type: "text/plain" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url; a.download = `${userId}-wireguard.conf`; a.click()
      URL.revokeObjectURL(url)
      toast({ title: "WireGuard config downloaded" })
    }
  }

  const sortedUsers = useMemo(
    () => [...usersVisible].sort((a, b) => a.userID.localeCompare(b.userID)),
    [usersVisible],
  )

  const adminCount = usersVisible.filter((u) => u.isAdmin).length

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total Users", value: usersVisible.length },
          { label: "Admins", value: adminCount, className: "text-primary" },
          { label: "Regular Users", value: usersVisible.length - adminCount },
        ].map(({ label, value, className }) => (
          <Card key={label} className="glass-card">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className={cn("text-2xl font-bold mt-1", className)}>{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Button onClick={() => setAddDialog(true)}>
          <Plus className="h-4 w-4" /> Add User
        </Button>
        <Button variant="ghost" size="icon" onClick={invalidateUsers} disabled={loading}>
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </Button>
      </div>

      {/* User table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 border-b border-border">
                    <th className="p-3 w-24"></th>
                    <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase">User ID</th>
                    <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase">Name</th>
                    <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase">Role</th>
                    <th className="p-3 text-left text-xs font-semibold text-muted-foreground uppercase">Range</th>
                    <th className="p-3 text-right text-xs font-semibold text-muted-foreground uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedUsers.map((user) => {
                    const userRangeIds = rangeMap[user.userID.toLowerCase()] || []
                    const rangeId = userRangeIds[0] || user.rangeID || user.defaultRangeID
                    return (
                      <tr key={user.userID} className="border-b border-border/50 last:border-0 hover:bg-muted/30">
                        <td className="p-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 gap-1.5 border-primary/30 text-primary hover:bg-primary/10 text-xs whitespace-nowrap"
                            onClick={() => startImpersonate(user.userID)}
                            disabled={fetchingKey === user.userID}
                            title={`Manage Ludus as ${user.userID}`}
                          >
                            {fetchingKey === user.userID
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : <Terminal className="h-3 w-3" />}
                            Manage
                          </Button>
                        </td>
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <div className="h-7 w-7 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                              <User className="h-3.5 w-3.5 text-primary" />
                            </div>
                            <code className="font-mono text-xs">{user.userID}</code>
                          </div>
                        </td>
                        <td className="p-3 text-muted-foreground text-xs">{user.name || "—"}</td>
                        <td className="p-3">
                          {user.isAdmin ? (
                            <Badge variant="cyan" className="text-xs gap-1">
                              <Shield className="h-2.5 w-2.5" /> Admin
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs">User</Badge>
                          )}
                        </td>
                        <td className="p-3">
                          <code className="text-xs text-muted-foreground font-mono">
                            {rangeId || "—"}
                          </code>
                        </td>
                        <td className="p-3">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              onClick={() => handleToggleAdmin(user.userID, !user.isAdmin)}
                              disabled={roleChanging === user.userID}
                              title={user.isAdmin ? `Revoke admin from ${user.userID}` : `Promote ${user.userID} to admin`}
                            >
                              {roleChanging === user.userID
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : user.isAdmin
                                  ? <ShieldOff className="h-3 w-3 text-yellow-400" />
                                  : <ShieldCheck className="h-3 w-3 text-cyan-400" />}
                            </Button>
                            <Button size="icon-sm" variant="ghost"
                              onClick={() => setConfirmRoll(user.userID)}
                              disabled={apiKeyLoading === user.userID}
                              title="Roll API key">
                              {apiKeyLoading === user.userID
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : <Key className="h-3 w-3 text-yellow-400" />}
                            </Button>
                            <Button size="icon-sm" variant="ghost"
                              onClick={() => { setChangePwUserId(user.userID); setChangePwValue(""); setChangePwConfirm(""); setShowChangePw(false) }}
                              title="Change password">
                              <Lock className="h-3 w-3 text-cyan-400" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1.5 border-blue-500/40 text-blue-400 hover:bg-blue-500/10 text-xs whitespace-nowrap"
                              onClick={() => void handleGetWireguard(user.userID)}
                              title="Download WireGuard client configuration"
                            >
                              <Download className="h-3 w-3 shrink-0" />
                              Download WireGuard
                            </Button>
                            <Button size="icon-sm" variant="ghost"
                              onClick={() => openDeleteDialog(user.userID)}
                              disabled={deletingUserId === user.userID}
                              title={deletingUserId === user.userID ? "Deleting…" : "Delete user"}>
                              {deletingUserId === user.userID
                                ? <Loader2 className="h-3 w-3 animate-spin text-red-400" />
                                : <Trash2 className="h-3 w-3 text-red-400" />}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Add User Dialog ─────────────────────────────────────────────────── */}
      <Dialog open={addDialog} onOpenChange={setAddDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add User</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>User ID <span className="text-red-400">*</span></Label>
              <Input
                placeholder="jd"
                value={newUserId}
                onChange={(e) => setNewUserId(sanitizeUserId(e.target.value))}
                className="font-mono"
                maxLength={32}
              />
              <p className="text-xs text-muted-foreground">
                Letters and numbers only; must start with a letter (max 32) — becomes the Linux username and home directory
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Password <span className="text-red-400">*</span></Label>
              <div className="flex gap-2">
                <Input type={showNewPassword ? "text" : "password"}
                  placeholder="Used for Proxmox and Ludus login"
                  value={newUserPassword} onChange={(e) => setNewUserPassword(e.target.value)} className="flex-1" />
                <Button type="button" size="icon" variant="ghost" onClick={() => setShowNewPassword(!showNewPassword)}>
                  {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Sets the Proxmox and Ludus SSH password</p>
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={newUserAdmin} onCheckedChange={setNewUserAdmin} />
              <div>
                <Label>Admin user</Label>
                <p className="text-xs text-muted-foreground">Can manage all ranges and users</p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setAddDialog(false); setShowNewPassword(false) }}>Cancel</Button>
            <Button
              onClick={handleAdd}
              disabled={
                adding ||
                !newUserId.trim() ||
                !newUserPassword.trim() ||
                !USER_ID_PATTERN.test(newUserId.trim())
              }
            >
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {adding ? "Creating… (up to 1 min)" : "Add User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation Dialog ──────────────────────────────────────── */}
      <Dialog open={!!confirmDelete} onOpenChange={() => setConfirmDelete(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-400">
              <Trash2 className="h-4 w-4" />
              Delete User <code className="font-mono text-primary">{confirmDelete?.userId}</code>?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <Alert variant="destructive">
              <AlertDescription className="text-xs">
                This will permanently delete the user and their Proxmox/Linux account. This cannot be undone.
              </AlertDescription>
            </Alert>
            {(confirmDelete?.rangeIds ?? []).length > 0 && (
              <div className="flex items-start gap-3 p-3 rounded-lg border border-border bg-muted/30">
                <input
                  type="checkbox"
                  id="delete-range"
                  checked={deleteRange}
                  onChange={(e) => setDeleteRange(e.target.checked)}
                  className="mt-0.5"
                />
                <label htmlFor="delete-range" className="text-xs cursor-pointer">
                  <span className="font-medium text-orange-400">Also delete range{(confirmDelete?.rangeIds?.length ?? 0) > 1 ? "s" : ""}: </span>
                  {confirmDelete?.rangeIds?.map((rid: string) => (
                    <code key={rid} className="font-mono text-primary mr-1">{rid}</code>
                  ))}
                  <p className="text-muted-foreground mt-0.5">
                    Destroys all VMs and range data. Cannot be undone.
                  </p>
                </label>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="destructive" className="gap-1.5" onClick={handleDelete}>
              <Trash2 className="h-3.5 w-3.5" />
              Delete User{deleteRange && (confirmDelete?.rangeIds?.length ?? 0) > 0 ? " + Range" : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Roll Key Confirmation ───────────────────────────────────────────── */}
      <Dialog open={!!confirmRoll} onOpenChange={() => setConfirmRoll(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-yellow-400" />
              Roll API Key for <code className="font-mono text-primary">{confirmRoll}</code>?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <Alert variant="warning">
              <AlertDescription className="text-xs space-y-1">
                <p>This will <strong>permanently invalidate</strong> the current API key and generate a new one.</p>
                <p>The new key will be written to the user&apos;s <code className="font-mono">.bashrc</code> automatically.</p>
                <p>Any running scripts using the old key will <strong>stop working immediately</strong>.</p>
              </AlertDescription>
            </Alert>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setConfirmRoll(null)}>Cancel</Button>
            <Button variant="destructive" className="gap-1.5" onClick={() => confirmRoll && handleRollApiKey(confirmRoll)}>
              <RefreshCw className="h-3.5 w-3.5" /> Yes, Roll Key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Roll Key Result ─────────────────────────────────────────────────── */}
      {apiKeyResult && (
        <Dialog open={!!apiKeyResult} onOpenChange={() => { setApiKeyResult(null); setShowApiKey(false) }}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Key className="h-4 w-4 text-yellow-400" />
                New API Key — <code className="font-mono text-primary">{apiKeyResult.userId}</code>
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {apiKeyResult.bashrcUpdated ? (
                <Alert>
                  <AlertDescription className="text-xs text-green-400">
                    ✓ Key written to <code className="font-mono">~{apiKeyResult.userId.toLowerCase()}/.bashrc</code>
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert variant="warning">
                  <AlertDescription className="text-xs space-y-1">
                    <p>⚠ Could not update .bashrc automatically.{apiKeyResult.bashrcError ? ` ${apiKeyResult.bashrcError}` : ""}</p>
                    <p>Set manually: <code className="font-mono">export LUDUS_API_KEY={apiKeyResult.key || "…"}</code></p>
                  </AlertDescription>
                </Alert>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">New API Key</Label>
                <div className="flex gap-2">
                  <Input type={showApiKey ? "text" : "password"} value={apiKeyResult.key} readOnly className="font-mono text-xs flex-1" />
                  <Button size="icon" variant="ghost" onClick={() => setShowApiKey(!showApiKey)}>
                    {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                  <Button size="icon" variant="ghost" disabled={!apiKeyResult.key}
                    onClick={() => { navigator.clipboard.writeText(apiKeyResult.key); toast({ title: "Copied" }) }}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => { setApiKeyResult(null); setShowApiKey(false) }}>Done</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Impersonation fallback dialog (when auto-read API key fails) ──── */}
      {impersonateTarget && (
        <Dialog open onOpenChange={() => setImpersonateTarget(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-primary" />
                Manage as <code className="text-primary font-mono">{impersonateTarget.userID}</code>
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <Alert>
                <AlertDescription className="text-xs">
                  Could not auto-read the API key from <code className="font-mono">~{impersonateTarget.userID}/.bashrc</code>{" "}
                  via root SSH. Enter it manually below.
                  Commands will run via <strong>root SSH</strong> + <code>sudo -u {impersonateTarget.userID}</code>.
                </AlertDescription>
              </Alert>
              <div className="space-y-1.5">
                <Label htmlFor="users-impersonate-apikey" className="text-xs">
                  {impersonateTarget.userID}&apos;s Ludus API Key
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="users-impersonate-apikey"
                    ref={apiKeyInputRef}
                    type={showImpersonateKey ? "text" : "password"}
                    placeholder="JUF3QT.XXXXXXXXXXXX"
                    className="font-mono text-xs flex-1"
                    value={impersonateApiKey}
                    onChange={(e) => setImpersonateApiKey(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") commitImpersonate() }}
                  />
                  <Button size="icon" variant="ghost" onClick={() => setShowImpersonateKey(!showImpersonateKey)}>
                    {showImpersonateKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setImpersonateTarget(null)}>Cancel</Button>
              <Button onClick={commitImpersonate} disabled={!impersonateApiKey.trim()}>
                <Terminal className="h-4 w-4" />
                Manage Ludus Ranges
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Change Password Dialog ──────────────────────────────────────────── */}
      <Dialog open={!!changePwUserId} onOpenChange={() => setChangePwUserId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-cyan-400" />
              Change Password — <code className="font-mono text-primary">{changePwUserId}</code>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-xs text-muted-foreground">
              Changes the Linux/PAM password shared between Proxmox and Ludus SSH login.
            </p>
            <div className="space-y-1.5">
              <Label>New Password <span className="text-red-400">*</span></Label>
              <div className="flex gap-2">
                <Input type={showChangePw ? "text" : "password"}
                  value={changePwValue} onChange={(e) => setChangePwValue(e.target.value)}
                  placeholder="New password" className="flex-1" />
                <Button type="button" size="icon" variant="ghost" onClick={() => setShowChangePw(!showChangePw)}>
                  {showChangePw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Confirm Password <span className="text-red-400">*</span></Label>
              <Input type={showChangePw ? "text" : "password"}
                value={changePwConfirm} onChange={(e) => setChangePwConfirm(e.target.value)}
                placeholder="Confirm new password"
                className={cn(changePwConfirm && changePwValue !== changePwConfirm ? "border-red-400" : "")} />
              {changePwConfirm && changePwValue !== changePwConfirm && (
                <p className="text-xs text-red-400">Passwords do not match</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setChangePwUserId(null)}>Cancel</Button>
            <Button onClick={handleChangePassword}
              disabled={changingPw || !changePwValue.trim() || changePwValue !== changePwConfirm}>
              {changingPw ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
              {changingPw ? "Changing…" : "Change Password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}