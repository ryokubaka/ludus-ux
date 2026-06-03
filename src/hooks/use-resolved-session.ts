"use client"

import { useEffect, useState } from "react"
import { useShellSession } from "@/components/providers/shell-session-provider"

export interface ResolvedSession {
  username: string
  isAdmin: boolean
  loading: boolean
}

/**
 * Shell snapshot for instant render, then live /api/auth/session (revalidates isAdmin from Ludus).
 */
export function useResolvedSession(): ResolvedSession | null {
  const shell = useShellSession()
  const [session, setSession] = useState<ResolvedSession | null>(() =>
    shell
      ? { username: shell.username, isAdmin: shell.isAdmin, loading: true }
      : null,
  )

  useEffect(() => {
    if (shell) {
      setSession({ username: shell.username, isAdmin: shell.isAdmin, loading: true })
    }

    let cancelled = false
    fetch("/api/auth/session")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.authenticated) return
        setSession({
          username: data.username,
          isAdmin: !!data.isAdmin,
          loading: false,
        })
      })
      .catch(() => {
        if (!cancelled && shell) {
          setSession({ username: shell.username, isAdmin: shell.isAdmin, loading: false })
        }
      })

    return () => {
      cancelled = true
    }
  }, [shell?.username, shell?.isAdmin])

  return session
}
