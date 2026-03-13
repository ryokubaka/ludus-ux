"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import {
  LayoutDashboard,
  FileCode2,
  Shield,
  Camera,
  BookTemplate,
  Users,
  Users2,
  Package,
  Zap,
  Settings,
  Terminal,
  ChevronRight,
  Lock,
  ScrollText,
  Monitor,
  ShieldCheck,
} from "lucide-react"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"

interface NavItem {
  href: string
  label: string
  icon: React.FC<React.SVGProps<SVGSVGElement>>
  adminOnly?: boolean
}

interface NavGroup {
  label: string
  items: NavItem[]
}

const navGroups: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
    ],
  },
  {
    label: "Range Management",
    items: [
      { href: "/range/config", label: "Configuration", icon: FileCode2 },
      { href: "/templates", label: "Templates", icon: BookTemplate },
      { href: "/testing", label: "Testing Mode", icon: Shield },
      { href: "/snapshots", label: "Snapshots", icon: Camera },
      { href: "/blueprints", label: "Blueprints", icon: Package },
      { href: "/ansible", label: "Ansible Roles", icon: Zap },
      { href: "/logs", label: "Range Logs", icon: ScrollText },
      { href: "/console", label: "Consoles", icon: Monitor },
    ],
  },
  {
    label: "Administration",
    items: [
      { href: "/admin", label: "Ranges Overview", icon: ShieldCheck, adminOnly: true },
      { href: "/users", label: "Users", icon: Users, adminOnly: true },
      { href: "/groups", label: "Groups", icon: Users2, adminOnly: true },
    ],
  },
  {
    label: "Integrations",
    items: [
      { href: "/goad", label: "GOAD Management", icon: Terminal },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
]

export function Sidebar() {
  const pathname = usePathname()
  const [isAdmin, setIsAdmin] = useState(false)
  const [hasCustomLogo, setHasCustomLogo] = useState(false)
  // Use a cache-busting key so the <img> refreshes after an upload/delete
  const [logoKey, setLogoKey] = useState(0)

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data?.isAdmin) setIsAdmin(true) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch("/api/logo", { method: "HEAD" })
      .then((r) => setHasCustomLogo(r.ok))
      .catch(() => setHasCustomLogo(false))
  }, [logoKey])

  // Let the settings page trigger a logo refresh
  useEffect(() => {
    const handler = () => setLogoKey((k) => k + 1)
    window.addEventListener("logo-updated", handler)
    return () => window.removeEventListener("logo-updated", handler)
  }, [])

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-64 bg-sidebar border-r border-sidebar-border flex flex-col">
      {/* Logo — clicking goes to the Dashboard */}
      <Link href="/" className="flex items-center gap-3 px-6 py-5 hover:opacity-80 transition-opacity">
        <div className="flex h-10 w-10 items-center justify-center rounded-md overflow-hidden flex-shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={hasCustomLogo ? `/api/logo?v=${logoKey}` : "/default-logo.jpeg"}
            alt="Logo"
            className="h-full w-full object-contain"
          />
        </div>
        <div>
          <span className="font-semibold text-foreground text-sm">Ludus UX</span>
          <p className="text-xs text-muted-foreground">Cyber Range Manager</p>
        </div>
      </Link>

      <Separator className="bg-sidebar-border" />

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {navGroups.map((group) => {
          // Filter admin-only items for non-admins but still show the section
          const visibleItems = group.items.filter(
            (item) => !item.adminOnly || isAdmin
          )
          if (visibleItems.length === 0) return null

          return (
            <div key={group.label}>
              <p className="px-3 mb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {group.label}
              </p>
              <ul className="space-y-0.5">
                {visibleItems.map((item) => {
                  const Icon = item.icon
                  const isActive =
                    item.href === "/"
                      ? pathname === "/"
                      : pathname === item.href || pathname.startsWith(item.href + "/")

                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={cn(
                          "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors group",
                          isActive
                            ? "bg-sidebar-accent text-sidebar-primary"
                            : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                        )}
                      >
                        <Icon className={cn("h-4 w-4 flex-shrink-0", isActive ? "text-sidebar-primary" : "")} />
                        <span className="flex-1">{item.label}</span>
                        {item.adminOnly && (
                          <Lock className="h-3 w-3 text-muted-foreground/50" />
                        )}
                        {isActive && (
                          <ChevronRight className="h-3 w-3 text-sidebar-primary" />
                        )}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-sidebar-border">
        <p className="text-xs text-muted-foreground text-center">
          Open Source · GNU APGL License
        </p>
      </div>
    </aside>
  )
}
