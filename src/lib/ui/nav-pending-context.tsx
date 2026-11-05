"use client"

import { usePathname } from "next/navigation"
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { navHrefMatches } from "@/lib/ui/nav-href"

type NavPendingContextValue = {
  pendingHref: string | null
  setPendingHref: (href: string | null) => void
}

const NavPendingContext = createContext<NavPendingContextValue | null>(null)

export function NavPendingProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [pendingHref, setPendingHrefState] = useState<string | null>(null)

  const setPendingHref = useCallback((href: string | null) => {
    setPendingHrefState(href)
  }, [])

  useEffect(() => {
    if (pendingHref && navHrefMatches(pathname, pendingHref)) {
      setPendingHrefState(null)
    }
  }, [pathname, pendingHref])

  const value = useMemo(
    () => ({ pendingHref, setPendingHref }),
    [pendingHref, setPendingHref],
  )

  return <NavPendingContext.Provider value={value}>{children}</NavPendingContext.Provider>
}

export function useNavPending(): NavPendingContextValue {
  const ctx = useContext(NavPendingContext)
  if (!ctx) {
    throw new Error("useNavPending must be used within NavPendingProvider")
  }
  return ctx
}
