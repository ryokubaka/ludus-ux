"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  User,
  Camera,
  Trash2,
  Lock,
  Eye,
  EyeOff,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Upload,
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

interface SessionInfo {
  username: string
  isAdmin: boolean
}

export default function AccountPage() {
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [session, setSession] = useState<SessionInfo | null>(null)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [avatarVersion, setAvatarVersion] = useState(0)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [removingAvatar, setRemovingAvatar] = useState(false)

  const [currentPw, setCurrentPw] = useState("")
  const [newPw, setNewPw] = useState("")
  const [confirmPw, setConfirmPw] = useState("")
  const [showCurrentPw, setShowCurrentPw] = useState(false)
  const [showNewPw, setShowNewPw] = useState(false)
  const [changingPw, setChangingPw] = useState(false)
  const [pwSuccess, setPwSuccess] = useState(false)

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.authenticated) setSession({ username: d.username, isAdmin: d.isAdmin }) })
      .catch(() => {})
  }, [])

  // Probe for existing avatar whenever session or version changes
  const refreshAvatar = useCallback(() => {
    setAvatarVersion((v) => v + 1)
  }, [])

  useEffect(() => {
    if (!session) return
    const url = `/api/profile/avatar?t=${avatarVersion}`
    // Test if avatar exists
    fetch(url, { method: "HEAD" })
      .then((r) => { setAvatarUrl(r.ok ? url : null) })
      .catch(() => setAvatarUrl(null))
  }, [session, avatarVersion])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 4 * 1024 * 1024) {
      toast({ variant: "destructive", title: "File too large", description: "Maximum size is 4 MB" })
      return
    }
    const reader = new FileReader()
    reader.onload = (ev) => setPreviewUrl(ev.target?.result as string)
    reader.readAsDataURL(file)
    setPendingFile(file)
  }

  const handleUploadAvatar = async () => {
    if (!pendingFile) return
    setUploadingAvatar(true)
    try {
      const form = new FormData()
      form.append("avatar", pendingFile)
      const res = await fetch("/api/profile/avatar", { method: "POST", body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      toast({ title: "Profile picture updated" })
      setPendingFile(null)
      setPreviewUrl(null)
      refreshAvatar()
      // Notify other components (e.g. header) that the avatar changed
      window.dispatchEvent(new CustomEvent("profile-avatar-updated"))
    } catch (err) {
      toast({ variant: "destructive", title: "Upload failed", description: (err as Error).message })
    } finally {
      setUploadingAvatar(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  const handleRemoveAvatar = async () => {
    setRemovingAvatar(true)
    try {
      await fetch("/api/profile/avatar", { method: "DELETE" })
      toast({ title: "Profile picture removed" })
      setAvatarUrl(null)
      setPendingFile(null)
      setPreviewUrl(null)
      window.dispatchEvent(new CustomEvent("profile-avatar-updated"))
    } catch (err) {
      toast({ variant: "destructive", title: "Error", description: (err as Error).message })
    } finally {
      setRemovingAvatar(false)
    }
  }

  const handleChangePassword = async () => {
    if (newPw !== confirmPw) {
      toast({ variant: "destructive", title: "Passwords do not match" })
      return
    }
    if (newPw.length < 8) {
      toast({ variant: "destructive", title: "Password too short", description: "Must be at least 8 characters" })
      return
    }
    setChangingPw(true)
    setPwSuccess(false)
    try {
      const res = await fetch("/api/profile/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setPwSuccess(true)
      setCurrentPw(""); setNewPw(""); setConfirmPw("")
      toast({ title: "Password changed successfully" })
    } catch (err) {
      toast({ variant: "destructive", title: "Password change failed", description: (err as Error).message })
    } finally {
      setChangingPw(false)
    }
  }

  const displayAvatar = previewUrl ?? avatarUrl
  const pwMismatch = confirmPw.length > 0 && newPw !== confirmPw
  const pwTooShort = newPw.length > 0 && newPw.length < 8

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Profile Picture */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Camera className="h-4 w-4 text-primary" />
            Profile Picture
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-8">
            {/* Avatar preview */}
            <div className="relative flex-shrink-0">
              <div className="h-28 w-28 rounded-full bg-primary/10 border-2 border-primary/20 overflow-hidden flex items-center justify-center">
                {displayAvatar ? (
                  <img
                    src={displayAvatar}
                    alt="Profile"
                    className="h-full w-full object-cover"
                    onError={() => { setAvatarUrl(null); setPreviewUrl(null) }}
                  />
                ) : (
                  <User className="h-12 w-12 text-primary/40" />
                )}
              </div>
              {/* Camera overlay */}
              <button
                className="absolute bottom-1 right-1 h-7 w-7 rounded-full bg-primary flex items-center justify-center shadow-lg hover:bg-primary/80 transition-colors"
                onClick={() => fileInputRef.current?.click()}
                title="Choose photo"
              >
                <Camera className="h-3.5 w-3.5 text-primary-foreground" />
              </button>
            </div>

            {/* Upload controls */}
            <div className="flex-1 space-y-3">
              <div>
                <p className="text-sm font-medium">{session?.username ?? "…"}</p>
                {session?.isAdmin && (
                  <p className="text-xs text-muted-foreground mt-0.5">Administrator</p>
                )}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={handleFileChange}
              />

              <div className="flex gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-3.5 w-3.5" />
                  {pendingFile ? "Change Selection" : "Choose Photo"}
                </Button>

                {pendingFile && (
                  <Button
                    size="sm"
                    className="gap-1.5"
                    onClick={handleUploadAvatar}
                    disabled={uploadingAvatar}
                  >
                    {uploadingAvatar
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <CheckCircle2 className="h-3.5 w-3.5" />}
                    Save Photo
                  </Button>
                )}

                {(avatarUrl && !pendingFile) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-red-400 hover:text-red-400 hover:bg-red-400/10"
                    onClick={handleRemoveAvatar}
                    disabled={removingAvatar}
                  >
                    {removingAvatar
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Trash2 className="h-3.5 w-3.5" />}
                    Remove
                  </Button>
                )}

                {pendingFile && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setPendingFile(null); setPreviewUrl(null); if (fileInputRef.current) fileInputRef.current.value = "" }}
                  >
                    Cancel
                  </Button>
                )}
              </div>

              <p className="text-xs text-muted-foreground">
                JPEG, PNG, WebP or GIF · Max 4 MB · Displayed next to your name in the header
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Change Password */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Lock className="h-4 w-4 text-primary" />
            Change Password
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {pwSuccess && (
            <Alert className="border-green-500/30 bg-green-500/10">
              <CheckCircle2 className="h-4 w-4 text-green-400" />
              <AlertDescription className="text-green-400 text-xs">
                Password changed successfully. Your new password is active immediately.
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">Current Password</Label>
            <div className="flex gap-2">
              <Input
                type={showCurrentPw ? "text" : "password"}
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                placeholder="Your current password"
                className="flex-1"
                autoComplete="current-password"
              />
              <Button size="icon" variant="ghost" onClick={() => setShowCurrentPw(!showCurrentPw)} tabIndex={-1}>
                {showCurrentPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">New Password</Label>
            <div className="flex gap-2">
              <Input
                type={showNewPw ? "text" : "password"}
                value={newPw}
                onChange={(e) => { setNewPw(e.target.value); setPwSuccess(false) }}
                placeholder="At least 8 characters"
                className={cn("flex-1", pwTooShort && "border-yellow-500/60")}
                autoComplete="new-password"
              />
              <Button size="icon" variant="ghost" onClick={() => setShowNewPw(!showNewPw)} tabIndex={-1}>
                {showNewPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            {pwTooShort && (
              <p className="text-xs text-yellow-400 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> At least 8 characters required
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Confirm New Password</Label>
            <Input
              type="password"
              value={confirmPw}
              onChange={(e) => { setConfirmPw(e.target.value); setPwSuccess(false) }}
              onKeyDown={(e) => { if (e.key === "Enter") handleChangePassword() }}
              placeholder="Repeat new password"
              className={cn(pwMismatch && "border-red-400/60")}
              autoComplete="new-password"
            />
            {pwMismatch && (
              <p className="text-xs text-red-400 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Passwords do not match
              </p>
            )}
          </div>

          <Button
            onClick={handleChangePassword}
            disabled={changingPw || !currentPw || !newPw || !confirmPw || pwMismatch || pwTooShort}
            className="w-full"
          >
            {changingPw ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
            {changingPw ? "Changing Password…" : "Change Password"}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
