"use client"

import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { User, Shield, LogOut, ChevronDown, Settings } from "lucide-react"
import { useSidebar } from "@/lib/sidebar-context"
import { cn } from "@/lib/utils"

const pageTitles: Record<string, { title: string; description: string }> = {
  "/": { title: "Dashboard", description: "Overview of your Ludus range" },
  "/range": { title: "Range", description: "Virtual machines and range status" },
  "/range/config": { title: "Range Configuration", description: "Edit and deploy your range YAML config" },
  "/templates": { title: "Templates", description: "Manage VM templates for your range" },
  "/testing": { title: "Testing Mode", description: "Control testing state and firewall rules" },
  "/snapshots": { title: "Snapshots", description: "Create and manage VM snapshots" },
  "/blueprints": { title: "Blueprints", description: "Save, share, and reuse range configurations" },
  "/ansible": { title: "Ansible Roles", description: "Manage Ansible roles and collections" },
  "/users": { title: "Users", description: "Manage Ludus users (admin only)" },
  "/groups": { title: "Groups", description: "Manage groups and range access" },
  "/logs": { title: "Range Logs", description: "Live and historical range deployment logs" },
  "/goad": { title: "GOAD Management", description: "Manage Game of Active Directory lab instances" },
  "/settings": { title: "Settings", description: "Configure Ludus connection and preferences" },
  "/account": { title: "User Settings", description: "Profile picture and password" },
}

interface SessionInfo {
  username: string
  isAdmin: boolean
}

export function Header() {
  const pathname = usePathname()
  const router = useRouter()
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [avatarVersion, setAvatarVersion] = useState(0)
  const { collapsed } = useSidebar()

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.authenticated) {
          setSession({ username: data.username, isAdmin: data.isAdmin })
        }
      })
      .catch(() => {})
  }, [])

  // Probe for avatar once session is known, and whenever avatarVersion bumps
  useEffect(() => {
    if (!session) return
    fetch(`/api/profile/avatar?t=${avatarVersion}`, { method: "HEAD" })
      .then((r) => {
        setAvatarUrl(r.ok ? `/api/profile/avatar?t=${avatarVersion}` : null)
      })
      .catch(() => setAvatarUrl(null))
  }, [session, avatarVersion])

  // Listen for avatar uploads from the settings page
  useEffect(() => {
    const handler = () => setAvatarVersion((v) => v + 1)
    window.addEventListener("profile-avatar-updated", handler)
    return () => window.removeEventListener("profile-avatar-updated", handler)
  }, [])

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" })
    sessionStorage.clear()
    router.push("/login")
  }

  const matchedKey = Object.keys(pageTitles)
    .sort((a, b) => b.length - a.length)
    .find((key) => pathname === key || (key !== "/" && pathname.startsWith(key + "/")))

  const pageInfo = (matchedKey && pageTitles[matchedKey]) || {
    title: "Ludus UX",
    description: "Cyber Range Manager",
  }

  return (
    <header
      className={cn(
        "fixed top-0 right-0 z-30 h-16 bg-background/80 backdrop-blur-sm border-b border-border flex items-center px-6 gap-4",
        "transition-[left] duration-200 ease-in-out",
        collapsed ? "left-16" : "left-64",
      )}
    >
      <div className="flex-1">
        <h1 className="text-base font-semibold text-foreground">{pageInfo.title}</h1>
        <p className="text-xs text-muted-foreground">{pageInfo.description}</p>
      </div>

      <div className="flex items-center gap-3">
        {session && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-2.5 h-10 px-2">
                {/* Avatar circle — larger than before */}
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/20 border-2 border-primary/30 overflow-hidden flex-shrink-0">
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt={session.username}
                      className="h-full w-full object-cover"
                      onError={() => setAvatarUrl(null)}
                    />
                  ) : session.isAdmin ? (
                    <Shield className="h-4 w-4 text-primary" />
                  ) : (
                    <User className="h-4 w-4 text-primary" />
                  )}
                </div>
                <span className="font-mono text-xs">{session.username}</span>
                {session.isAdmin && (
                  <Badge variant="cyan" className="text-xs px-1 py-0 h-4">
                    admin
                  </Badge>
                )}
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel className="flex items-center gap-2.5 py-2">
                <div className="h-8 w-8 rounded-full bg-primary/20 border border-primary/30 overflow-hidden flex items-center justify-center flex-shrink-0">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt={session.username} className="h-full w-full object-cover" />
                  ) : session.isAdmin ? (
                    <Shield className="h-3.5 w-3.5 text-primary" />
                  ) : (
                    <User className="h-3.5 w-3.5 text-primary" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground leading-none">Signed in as</p>
                  <p className="font-mono font-semibold text-foreground text-xs mt-0.5 truncate">
                    {session.username}
                  </p>
                </div>
              </DropdownMenuLabel>

              <DropdownMenuSeparator />

              <DropdownMenuItem asChild className="cursor-pointer gap-2">
                <Link href="/account">
                  <Settings className="h-3.5 w-3.5" />
                  User Settings
                </Link>
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuItem
                className="text-red-400 focus:text-red-400 cursor-pointer gap-2"
                onClick={handleLogout}
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  )
}
