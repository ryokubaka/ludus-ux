"use client"

import { createContext, useContext, useState, useEffect, useCallback } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { impersonationHeadersFromData, IMPERSONATION_STORAGE_KEY } from "./impersonation-headers"

export { IMPERSONATION_STORAGE_KEY }
/** Dispatched on `window` in the same tab after writing to sessionStorage. */
export const IMPERSONATION_CHANGED_EVENT = "impersonation-changed"

const STORAGE_KEY = IMPERSONATION_STORAGE_KEY

/** In-memory impersonation state (username only — apiKey lives in the cookie). */
export interface ImpersonationData {
  username: string
}

interface ImpersonationContextValue {
  impersonation: ImpersonationData | null
  exitImpersonation: () => void
  /** Headers to attach to API fetch calls that should run under the impersonated user. */
  impersonationHeaders: () => Record<string, string>
}

const ImpersonationContext = createContext<ImpersonationContextValue>({
  impersonation: null,
  exitImpersonation: () => { },
  impersonationHeaders: () => ({}),
})

function readStorage(): ImpersonationData | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { username?: string }
    return parsed.username ? { username: parsed.username } : null
  } catch {
    return null
  }
}

/**
 * Start impersonating a user.
 *
 * The apiKey is POSTed to the session cookie (httpOnly, encrypted) and then
 * discarded from JS memory — it is never written to sessionStorage.
 * Only the username is persisted locally so the UI can show who is being
 * impersonated. All server-side routes read the apiKey from the cookie via
 * resolveAdminImpersonationFromRequest.
 */
export async function saveImpersonation(data: { username: string; apiKey: string }): Promise<void> {
  // Store only the username — never the apiKey — in sessionStorage.
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ username: data.username }))
  // Cookie update must complete before dispatching the changed event so that
  // queries refetching on the event use the new user's API key from the cookie.
  await fetch("/api/auth/impersonate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: data.username, apiKey: data.apiKey }),
  }).catch(() => { /* non-fatal — cookie update is best-effort */ })
  window.dispatchEvent(new Event(IMPERSONATION_CHANGED_EVENT))
}

export function ImpersonationProvider({ children }: { children: React.ReactNode }) {
  const [impersonation, setImpersonation] = useState<ImpersonationData | null>(null)
  const queryClient = useQueryClient()

  useEffect(() => {
    // Immediately apply sessionStorage state (for instant UI)
    const stored = readStorage()
    setImpersonation(stored)

    // Sync sessionStorage against the session cookie. The cookie is authoritative.
    fetch("/api/auth/impersonate")
      .then((r) => r.ok ? r.json() : null)
      .then((data: { impersonating: boolean; username: string | null } | null) => {
        if (!data) return
        if (data.impersonating && data.username) {
          if (!stored) {
            // New tab: cookie has impersonation but sessionStorage is empty.
            // Restore the username from the cookie response — the apiKey stays
            // in the cookie and does not need to be in sessionStorage.
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ username: data.username }))
            setImpersonation({ username: data.username })
          }
        } else if (!data.impersonating && stored) {
          // Cookie says NOT impersonating but sessionStorage has stale data —
          // clear it (cookie is authoritative after logout or explicit deletion).
          sessionStorage.removeItem(STORAGE_KEY)
          setImpersonation(null)
          queryClient.clear()
        }
      })
      .catch(() => { })

    // Re-read when the same-tab code dispatches our custom event after writing
    // to sessionStorage.  (The native 'storage' event only fires in other tabs.)
    const handleChanged = () => {
      const next = readStorage()
      setImpersonation(next)
      // Clear the entire query cache so the new user's pages load fresh data
      // immediately, rather than briefly flashing stale data from the previous
      // identity before a background refetch completes.
      queryClient.clear()
    }
    window.addEventListener(IMPERSONATION_CHANGED_EVENT, handleChanged)

    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        setImpersonation(e.newValue ? JSON.parse(e.newValue) : null)
        queryClient.clear()
      }
    }
    window.addEventListener("storage", handleStorage)

    return () => {
      window.removeEventListener(IMPERSONATION_CHANGED_EVENT, handleChanged)
      window.removeEventListener("storage", handleStorage)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const exitImpersonation = useCallback(() => {
    // Clear UI state immediately so the banner disappears without waiting.
    sessionStorage.removeItem(STORAGE_KEY)
    setImpersonation(null)
    // The session cookie MUST be cleared before dispatching the event.
    // Queries refetch on the event and hit the proxy — if the cookie still
    // holds the impersonated user's API key the proxy will use it (session
    // takes priority over headers), returning impersonated data again.
    fetch("/api/auth/impersonate", { method: "DELETE" })
      .catch(() => { })
      .finally(() => {
        // Cookie is clear — safe to invalidate; proxy prefers X-Impersonate-* when sent.
        window.dispatchEvent(new Event(IMPERSONATION_CHANGED_EVENT))
      })
  }, [])

  const impersonationHeaders = useCallback((): Record<string, string> => {
    return impersonationHeadersFromData(impersonation)
  }, [impersonation])

  return (
    <ImpersonationContext.Provider value={{ impersonation, exitImpersonation, impersonationHeaders }}>
      {children}
    </ImpersonationContext.Provider>
  )
}

export function useImpersonation() {
  return useContext(ImpersonationContext)
}