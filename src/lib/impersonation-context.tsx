"use client"

import { createContext, useContext, useState, useEffect, useCallback } from "react"
import { useQueryClient } from "@tanstack/react-query"

export interface ImpersonationData {
  username: string
  apiKey: string
}

interface ImpersonationContextValue {
  impersonation: ImpersonationData | null
  exitImpersonation: () => void
  /** Headers to attach to API fetch calls that should run under the impersonated user. */
  impersonationHeaders: () => Record<string, string>
}

const ImpersonationContext = createContext<ImpersonationContextValue>({
  impersonation: null,
  exitImpersonation: () => {},
  impersonationHeaders: () => ({}),
})

export const IMPERSONATION_STORAGE_KEY = "goad_impersonation"
const STORAGE_KEY = IMPERSONATION_STORAGE_KEY
/** Dispatched on `window` in the same tab after writing to sessionStorage. */
export const IMPERSONATION_CHANGED_EVENT = "impersonation-changed"

function readStorage(): ImpersonationData | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/** Write impersonation to both sessionStorage and the session cookie. */
export async function saveImpersonation(data: ImpersonationData): Promise<void> {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  window.dispatchEvent(new Event(IMPERSONATION_CHANGED_EVENT))
  // Persist to cookie so server-side prefetch uses the correct identity on refresh
  await fetch("/api/auth/impersonate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: data.username, apiKey: data.apiKey }),
  }).catch(() => { /* non-fatal — client-side state is already updated */ })
}

export function ImpersonationProvider({ children }: { children: React.ReactNode }) {
  const [impersonation, setImpersonation] = useState<ImpersonationData | null>(null)
  const queryClient = useQueryClient()

  useEffect(() => {
    // Immediately apply sessionStorage state (for instant UI)
    const stored = readStorage()
    setImpersonation(stored)

    // Verify against the session cookie and sync if they differ.
    // This handles the case where a new tab is opened (sessionStorage is empty
    // but the cookie still has impersonation state) or a stale sessionStorage
    // value remains after the cookie was cleared (e.g. manual cookie deletion).
    fetch("/api/auth/impersonate")
      .then((r) => r.ok ? r.json() : null)
      .then((data: { impersonating: boolean; username: string | null } | null) => {
        if (!data) return
        if (data.impersonating && data.username) {
          // Cookie says impersonating — make sure sessionStorage matches.
          // We don't have the apiKey from GET /api/auth/impersonate (it's not
          // exposed), so only fix the "sessionStorage is empty" case here.
          // If sessionStorage already has data, trust it (it has the apiKey).
          if (!stored) {
            // Cookie has impersonation but sessionStorage doesn't — this can
            // happen in a new tab.  We can't reconstruct the full data without
            // the apiKey, so clear the cookie to keep things consistent.
            fetch("/api/auth/impersonate", { method: "DELETE" }).catch(() => {})
          }
        } else if (!data.impersonating && stored) {
          // Cookie says NOT impersonating but sessionStorage has data — clear
          // sessionStorage to match (cookie is authoritative after a logout
          // or explicit cookie deletion).
          sessionStorage.removeItem(STORAGE_KEY)
          setImpersonation(null)
          queryClient.clear()
        }
      })
      .catch(() => {})

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
      .catch(() => {})
      .finally(() => {
        // Cookie is clear — now safe to invalidate queries and re-fetch as admin.
        window.dispatchEvent(new Event(IMPERSONATION_CHANGED_EVENT))
      })
  }, [])

  const impersonationHeaders = useCallback((): Record<string, string> => {
    if (!impersonation) return {}
    return {
      "X-Impersonate-As": impersonation.username,
      "X-Impersonate-Apikey": impersonation.apiKey,
    }
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
