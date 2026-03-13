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
  Server,
  Users,
  Users2,
  Package,
  Zap,
  Plus,
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
import { useRange } from "@/lib/range-context"

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
      { href: "/range/new", label: "Deploy New Range", icon: Plus },
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
  const [logoKey, setLogoKey] = useState(0)
  const { ranges, selectedRangeId, selectRange, loading: rangesLoading } = useRange()
  const [rangeDropdownOpen, setRangeDropdownOpen] = useState(false)

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

      {/* Range selector */}
      {!rangesLoading && ranges.length > 0 && (
        <div className="px-3 py-2">
          <p className="px-3 mb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Active Range
          </p>
          <div className="relative">
            <button
              onClick={() => setRangeDropdownOpen((o) => !o)}
              className="w-full flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium
                         bg-sidebar-accent/50 hover:bg-sidebar-accent text-sidebar-foreground transition-colors"
            >
              <Server className="h-4 w-4 text-primary flex-shrink-0" />
              <span className="flex-1 text-left truncate font-mono text-xs">
                {selectedRangeId || "Select range"}
              </span>
              <ChevronRight className={cn("h-3 w-3 transition-transform", rangeDropdownOpen && "rotate-90")} />
            </button>
            {rangeDropdownOpen && (
              <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-md border border-sidebar-border bg-sidebar shadow-lg py-1 max-h-48 overflow-y-auto">
                {ranges.map((r) => (
                  <button
                    key={r.rangeID}
                    onClick={() => { selectRange(r.rangeID); setRangeDropdownOpen(false) }}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-1.5 text-xs font-mono transition-colors",
                      r.rangeID === selectedRangeId
                        ? "bg-primary/10 text-primary"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                    )}
                  >
                    <span className="flex-1 text-left truncate">{r.rangeID}</span>
                    <Badge variant="secondary" className="text-[10px] px-1 py-0">{r.accessType}</Badge>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

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
