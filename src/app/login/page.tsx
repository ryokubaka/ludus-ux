"use client"

import { useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Lock,
  User,
  Key,
  Loader2,
  Terminal,
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  ArrowRight,
} from "lucide-react"

type Step = "credentials" | "set-api-key"

export default function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Only allow relative paths starting with "/" to prevent open-redirect abuse
  // (e.g. /login?next=//evil.com or /login?next=https://attacker.com).
  const rawNext = searchParams.get("next") || "/"
  const nextPath = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/"

  const [step, setStep] = useState<Step>("credentials")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [apiKey, setApiKey] = useState("")
  const [showApiKey, setShowApiKey] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingUsername, setPendingUsername] = useState("")
  const [pendingPassword, setPendingPassword] = useState("")

  // If already logged in, skip to dashboard
  useEffect(() => {
    fetch("/api/auth/session").then((r) => {
      if (r.ok) router.replace(nextPath)
    })
  }, [router, nextPath])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password) return

    setLoading(true)
    setError(null)

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || "Login failed")
        return
      }

      if (data.needsApiKey) {
        // SSH auth succeeded but key missing from .bashrc, or existing key is stale
        setPendingUsername(username.trim())
        setPendingPassword(password)
        setStep("set-api-key")
        if (data.staleKey) {
          setError("Your API key in ~/.bashrc is invalid or expired. Enter your current Ludus API key below.")
        }
        return
      }

      // Fully logged in
      router.replace(nextPath)
    } catch {
      setError("Network error — could not reach the server")
    } finally {
      setLoading(false)
    }
  }

  const handleSetApiKey = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!apiKey.trim()) return

    setLoading(true)
    setError(null)

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: pendingUsername,
          password: pendingPassword,
          apiKey: apiKey.trim(),
        }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || "Failed to save API key")
        return
      }

      router.replace(nextPath)
    } catch {
      setError("Network error")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      {/* Background grid decoration */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(34,211,238,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,0.03)_1px,transparent_1px)] bg-[size:64px_64px] pointer-events-none" />

      <div className="w-full max-w-md relative">
        {/* Logo / Brand */}
        <div className="flex flex-col items-center mb-8">
          <div className="h-14 w-14 rounded-xl bg-primary/20 border border-primary/30 flex items-center justify-center mb-4 glow-cyan">
            <Terminal className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-gradient">Ludus UX</h1>
          <p className="text-sm text-muted-foreground mt-1">Cyber Range Manager</p>
        </div>

        <Card className="border-border/60 shadow-2xl shadow-black/40">
          {step === "credentials" ? (
            <>
              <CardHeader className="pb-4">
                <CardTitle className="text-lg">Sign In</CardTitle>
                <CardDescription>
                  Connect using your Ludus server SSH credentials
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleLogin} className="space-y-4">
                  {error && (
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}

                  <div className="space-y-1.5">
                    <Label htmlFor="username">Username</Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="username"
                        autoComplete="username"
                        placeholder="root or your Ludus username"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="pl-9 font-mono"
                        autoFocus
                        disabled={loading}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Login with your personal Ludus account (not root)
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="password">Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        placeholder="SSH password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="pl-9 pr-10"
                        disabled={loading}
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <Button
                    type="submit"
                    className="w-full"
                    disabled={loading || !username.trim() || !password}
                  >
                    {loading ? (
                      <><Loader2 className="h-4 w-4 animate-spin" /> Connecting...</>
                    ) : (
                      <><ArrowRight className="h-4 w-4" /> Sign In</>
                    )}
                  </Button>
                </form>

                <div className="mt-5 p-3 rounded-md bg-muted/40 border border-border/50">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    <span className="text-foreground font-medium">How it works:</span>{" "}
                    The UI connects to your Ludus server over SSH, reads your{" "}
                    <code className="text-primary">LUDUS_API_KEY</code> from{" "}
                    <code className="text-primary">~/.bashrc</code>, and creates an
                    authenticated session. Credentials are never stored.
                  </p>
                </div>
              </CardContent>
            </>
          ) : (
            <>
              <CardHeader className="pb-4">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle2 className="h-5 w-5 text-green-400" />
                  <CardTitle className="text-lg">SSH Connected</CardTitle>
                </div>
                <CardDescription>
                  Logged in as <code className="text-primary">{pendingUsername}</code>.
                  Enter your current <code className="text-primary">LUDUS_API_KEY</code> to continue.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSetApiKey} className="space-y-4">
                  {error && (
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}

                  <Alert>
                    <Key className="h-4 w-4" />
                    <AlertDescription className="text-xs">
                      Enter your Ludus API key below. It will be saved to your{" "}
                      <code className="text-primary">~/.bashrc</code> on the Ludus server
                      so you only need to do this once.
                    </AlertDescription>
                  </Alert>

                  <div className="space-y-1.5">
                    <Label htmlFor="api-key">Ludus API Key</Label>
                    <div className="relative">
                      <Key className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="api-key"
                        type={showApiKey ? "text" : "password"}
                        placeholder="Paste your API key..."
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        className="pl-9 pr-10 font-mono text-xs"
                        autoFocus
                        disabled={loading}
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => setShowApiKey(!showApiKey)}
                      >
                        {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Find your key: SSH into the Ludus server and run{" "}
                      <code className="text-primary">ludus user apikey</code> or check{" "}
                      <code className="text-primary">~/.bashrc</code>
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => { setStep("credentials"); setError(null) }}
                      disabled={loading}
                      className="flex-1"
                    >
                      Back
                    </Button>
                    <Button
                      type="submit"
                      className="flex-1"
                      disabled={loading || !apiKey.trim()}
                    >
                      {loading ? (
                        <><Loader2 className="h-4 w-4 animate-spin" /> Saving...</>
                      ) : (
                        <><CheckCircle2 className="h-4 w-4" /> Save &amp; Continue</>
                      )}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </>
          )}
        </Card>

        <p className="text-center text-xs text-muted-foreground mt-4">
          Ludus UX · Open Source · GNU APGL License
        </p>
      </div>
    </div>
  )
}
