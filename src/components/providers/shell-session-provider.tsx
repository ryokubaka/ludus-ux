"use client"

import { createContext, useContext, useEffect, useState } from "react"
import { AUTH_CHANGED_EVENT } from "@/lib/client-auth-state"
import { fetchSharedSession } from "@/lib/session-fetch"

/** Non-secret snapshot from server session (RootLayout); avoids redundant /api/auth/session. */
export interface ShellSessionSnapshot {
  username: string
  isAdmin: boolean
  impersonationUserId: string | null
}

const ShellSessionContext = createContext<ShellSessionSnapshot | null>(null)

async function fetchShellSessionSnapshot(): Promise<ShellSessionSnapshot | null> {
  const r = await fetchSharedSession()
  if (!r.ok) return null
  const data = (await r.json()) as {
    authenticated?: boolean
    username?: string
    isAdmin?: boolean
    impersonationLudusPrincipal?: string | null
  }
  if (!data.authenticated || !data.username) return null
  return {
    username: data.username,
    isAdmin: !!data.isAdmin,
    impersonationUserId: data.impersonationLudusPrincipal ?? null,
  }
}

export function ShellSessionProvider({
  value,
  children,
}: {
  value: ShellSessionSnapshot | null
  children: React.ReactNode
}) {
  const [resolved, setResolved] = useState(value)

  useEffect(() => {
    setResolved(value)
  }, [value?.username, value?.isAdmin, value?.impersonationUserId])

  useEffect(() => {
    let cancelled = false
    const sync = () => {
      void fetchShellSessionSnapshot().then((next) => {
        if (!cancelled) setResolved(next)
      })
    }
    sync()
    window.addEventListener(AUTH_CHANGED_EVENT, sync)
    return () => {
      cancelled = true
      window.removeEventListener(AUTH_CHANGED_EVENT, sync)
    }
  }, [value?.username])

  useEffect(() => {
    if (!resolved?.username) return
    try {
      sessionStorage.setItem("ludus-auth-username", resolved.username)
    } catch {
      /* private mode */
    }
  }, [resolved?.username])

  return (
    <ShellSessionContext.Provider value={resolved}>{children}</ShellSessionContext.Provider>
  )
}

export function useShellSession(): ShellSessionSnapshot | null {
  return useContext(ShellSessionContext)
}
