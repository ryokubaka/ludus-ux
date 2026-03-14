"use client"

import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
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
import { User, Shield, LogOut, ChevronDown } from "lucide-react"
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
}

interface SessionInfo {
  username: string
  isAdmin: boolean
}

export function Header() {
  const pathname = usePathname()
  const router = useRouter()
  const [session, setSession] = useState<SessionInfo | null>(null)
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

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" })
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
              <Button variant="ghost" size="sm" className="gap-2 h-8">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/20 border border-primary/30">
                  {session.isAdmin ? (
                    <Shield className="h-3 w-3 text-primary" />
                  ) : (
                    <User className="h-3 w-3 text-primary" />
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
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                Signed in as
                <span className="block font-mono font-semibold text-foreground mt-0.5">
                  {session.username}
                </span>
              </DropdownMenuLabel>
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
