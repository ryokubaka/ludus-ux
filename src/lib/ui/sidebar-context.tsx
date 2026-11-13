"use client"

import { createContext, useContext, useState, useEffect, useCallback } from "react"

interface SidebarContextValue {
  collapsed: boolean
  toggle: () => void
  /** Off-canvas sidebar on viewports below `lg`. */
  mobileOpen: boolean
  setMobileOpen: (open: boolean) => void
  closeMobile: () => void
}

const SidebarContext = createContext<SidebarContextValue>({
  collapsed: false,
  toggle: () => {},
  mobileOpen: false,
  setMobileOpen: () => {},
  closeMobile: () => {},
})

const STORAGE_KEY = "ludus-sidebar-collapsed"
const MOBILE_QUERY = "(min-width: 1024px)"

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  // Hydrate from localStorage after mount (avoids SSR mismatch)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored === "true") setCollapsed(true)
    } catch {}
  }, [])

  // A drawer that stays open when the viewport grows would double the sidebar.
  useEffect(() => {
    if (typeof window === "undefined") return
    const mq = window.matchMedia(MOBILE_QUERY)
    const onChange = () => {
      if (mq.matches) setMobileOpen(false)
    }
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      try { localStorage.setItem(STORAGE_KEY, String(next)) } catch {}
      return next
    })
  }, [])

  const closeMobile = useCallback(() => setMobileOpen(false), [])

  return (
    <SidebarContext.Provider value={{ collapsed, toggle, mobileOpen, setMobileOpen, closeMobile }}>
      {children}
    </SidebarContext.Provider>
  )
}

export function useSidebar() {
  return useContext(SidebarContext)
}
