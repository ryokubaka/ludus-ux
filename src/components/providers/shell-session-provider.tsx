"use client"

import { createContext, useContext, useEffect } from "react"

/** Non-secret snapshot from server session (RootLayout); avoids redundant /api/auth/session. */
export interface ShellSessionSnapshot {
  username: string
  isAdmin: boolean
  impersonationUserId: string | null
}

const ShellSessionContext = createContext<ShellSessionSnapshot | null>(null)

export function ShellSessionProvider({
  value,
  children,
}: {
  value: ShellSessionSnapshot | null
  children: React.ReactNode
}) {
  useEffect(() => {
    if (!value?.username) return
    try {
      sessionStorage.setItem("ludus-auth-username", value.username)
    } catch {
      /* private mode */
    }
  }, [value?.username])

  return <ShellSessionContext.Provider value={value}>{children}</ShellSessionContext.Provider>
}

export function useShellSession(): ShellSessionSnapshot | null {
  return useContext(ShellSessionContext)
}
