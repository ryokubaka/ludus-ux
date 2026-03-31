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
  PanelLeftClose,
  PanelLeftOpen,
  ExternalLink,
} from "lucide-react"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useRange } from "@/lib/range-context"
import { useSidebar } from "@/lib/sidebar-context"

interface NavItem {
  href: string
  label: string
  icon: React.FC<React.SVGProps<SVGSVGElement>>
  adminOnly?: boolean
  goadOnly?: boolean
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
      { href: "/goad", label: "GOAD Management", icon: Terminal, goadOnly: true },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
]

const ADMIN_CACHE_KEY = "ludus-sidebar-is-admin"
const GOAD_CACHE_KEY = "ludus-sidebar-goad-enabled"

export function Sidebar() {
  const pathname = usePathname()
  const { collapsed, toggle } = useSidebar()

  // Initialise from sessionStorage so cached values apply on the very first
  // render after a page reload — eliminating the "admin items pop in later" flash.
  // The API calls below run in the background to verify and refresh the cache.
  const [isAdmin, setIsAdmin] = useState(false)
  const [goadEnabled, setGoadEnabled] = useState(true)
  const [hasCustomLogo, setHasCustomLogo] = useState(false)
  const [logoKey, setLogoKey] = useState(0)
  const { ranges, selectedRangeId, selectRange, loading: rangesLoading } = useRange()
  const [rangeDropdownOpen, setRangeDropdownOpen] = useState(false)

  // On mount: apply cached values instantly, then verify in background
  useEffect(() => {
    const cachedAdmin = sessionStorage.getItem(ADMIN_CACHE_KEY)
    if (cachedAdmin === "true") setIsAdmin(true)

    fetch("/api/auth/session")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        const admin = !!data?.isAdmin
        setIsAdmin(admin)
        sessionStorage.setItem(ADMIN_CACHE_KEY, String(admin))
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const cachedGoad = sessionStorage.getItem(GOAD_CACHE_KEY)
    if (cachedGoad !== null) setGoadEnabled(cachedGoad !== "false")

    fetch("/api/settings")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data && typeof data.goadEnabled === "boolean") {
          setGoadEnabled(data.goadEnabled)
          sessionStorage.setItem(GOAD_CACHE_KEY, String(data.goadEnabled))
        }
      })
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

  // Close range dropdown when collapsing
  useEffect(() => {
    if (collapsed) setRangeDropdownOpen(false)
  }, [collapsed])

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          "fixed left-0 top-0 z-40 h-screen bg-sidebar border-r border-sidebar-border flex flex-col",
          "transition-[width] duration-200 ease-in-out",
          collapsed ? "w-16" : "w-64",
        )}
      >
        {/* Logo */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href="/"
              className={cn(
                "flex items-center gap-3 hover:opacity-80 transition-opacity flex-shrink-0",
                collapsed ? "px-3 py-5 justify-center" : "px-6 py-5",
              )}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-md overflow-hidden flex-shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={hasCustomLogo ? `/api/logo?v=${logoKey}` : "/default-logo.jpeg"}
                  alt="Logo"
                  className="h-full w-full object-contain"
                />
              </div>
              {!collapsed && (
                <div>
                  <span className="font-semibold text-foreground text-sm">Ludus UX</span>
                  <p className="text-xs text-muted-foreground">Cyber Range Manager</p>
                </div>
              )}
            </Link>
          </TooltipTrigger>
          {collapsed && (
            <TooltipContent side="right">Ludus UX — Dashboard</TooltipContent>
          )}
        </Tooltip>

        <Separator className="bg-sidebar-border" />

        {/* Range selector */}
        {!rangesLoading && ranges.length > 0 && (
          <div className={cn("py-2", collapsed ? "px-2" : "px-3")}>
            {!collapsed && (
              <p className="px-3 mb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Active Range
              </p>
            )}
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex justify-center py-1">
                    <Server className="h-5 w-5 text-primary" />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p className="font-semibold text-xs">Active Range</p>
                  <p className="font-mono text-xs">{selectedRangeId || "None selected"}</p>
                </TooltipContent>
              </Tooltip>
            ) : (
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
            )}
          </div>
        )}

        {/* Navigation */}
        <nav className={cn("flex-1 overflow-y-auto py-4 space-y-6", collapsed ? "px-2" : "px-3")}>
          {navGroups.map((group) => {
            const visibleItems = group.items.filter(
              (item) => (!item.adminOnly || isAdmin) && (!item.goadOnly || goadEnabled)
            )
            if (visibleItems.length === 0) return null

            return (
              <div key={group.label}>
                {/* Group label — hidden when collapsed */}
                {!collapsed && (
                  <p className="px-3 mb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {group.label}
                  </p>
                )}
                {/* Divider between groups when collapsed */}
                {collapsed && (
                  <div className="h-px bg-sidebar-border/60 mb-2" />
                )}
                <ul className="space-y-0.5">
                  {visibleItems.map((item) => {
                    const Icon = item.icon
                    const isActive =
                      item.href === "/"
                        ? pathname === "/"
                        : pathname === item.href || pathname.startsWith(item.href + "/")

                    if (collapsed) {
                      const isConsoles = item.href === "/console"
                      return (
                        <div key={item.href} className="relative group/collapsed">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Link
                                href={item.href}
                                className={cn(
                                  "flex items-center justify-center rounded-md p-2 transition-colors",
                                  isActive
                                    ? "bg-sidebar-accent text-sidebar-primary"
                                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                                )}
                              >
                                <Icon className={cn("h-5 w-5 flex-shrink-0", isActive ? "text-sidebar-primary" : "")} />
                              </Link>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="flex items-center gap-2">
                              {item.label}
                              {item.adminOnly && <Lock className="h-3 w-3 text-muted-foreground/60" />}
                              {isConsoles && <ExternalLink className="h-3 w-3 text-muted-foreground/60 cursor-pointer"
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.open("/console", "_blank", "noopener,noreferrer") }}
                              />}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      )
                    }

                    // Consoles gets a special inline "open in new window" button
                    const isConsoles = item.href === "/console"

                    return (
                      <li key={item.href} className="flex items-center gap-0.5">
                        <Link
                          href={item.href}
                          className={cn(
                            "flex flex-1 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors group",
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
                          {isActive && !isConsoles && (
                            <ChevronRight className="h-3 w-3 text-sidebar-primary" />
                          )}
                        </Link>
                        {isConsoles && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                onClick={(e) => {
                                  e.preventDefault()
                                  window.open("/console", "_blank", "noopener,noreferrer")
                                }}
                                className={cn(
                                  "flex items-center justify-center rounded-md p-1.5 transition-colors shrink-0",
                                  isActive
                                    ? "text-sidebar-primary hover:bg-sidebar-accent/80"
                                    : "text-sidebar-foreground/40 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                                )}
                                aria-label="Open Consoles in new window"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="text-xs">
                              Open Consoles in new window
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
        </nav>

        {/* Footer / Collapse toggle */}
        <div className={cn(
          "border-t border-sidebar-border flex items-center",
          collapsed ? "px-2 py-3 justify-center" : "px-4 py-3 justify-between",
        )}>
          {!collapsed && (
            <div className="flex flex-col gap-0.5">
              <p className="text-xs font-semibold text-muted-foreground">v0.9.0 <span className="font-normal text-muted-foreground/60">beta</span></p>
              <p className="text-xs text-muted-foreground/60">Open Source · Apache 2.0</p>
            </div>
          )}
          {collapsed && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-[10px] text-muted-foreground/50 font-mono cursor-default select-none">v0.9</span>
              </TooltipTrigger>
              <TooltipContent side="right">v0.9.0 beta — Open Source · Apache 2.0</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={toggle}
                className="flex items-center justify-center rounded-md p-1.5 text-muted-foreground
                           hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                {collapsed
                  ? <PanelLeftOpen className="h-4 w-4" />
                  : <PanelLeftClose className="h-4 w-4" />
                }
              </button>
            </TooltipTrigger>
            <TooltipContent side={collapsed ? "right" : "top"}>
              {collapsed ? "Expand sidebar" : "Collapse sidebar"}
            </TooltipContent>
          </Tooltip>
        </div>
      </aside>
    </TooltipProvider>
  )
}
