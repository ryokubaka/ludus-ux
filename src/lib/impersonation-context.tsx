"use client"

import { createContext, useContext, useState, useEffect, useCallback } from "react"

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

export function ImpersonationProvider({ children }: { children: React.ReactNode }) {
  const [impersonation, setImpersonation] = useState<ImpersonationData | null>(null)

  useEffect(() => {
    // Initial read on mount
    setImpersonation(readStorage())

    // Re-read when the same-tab code dispatches our custom event after writing to sessionStorage.
    // Note: the native 'storage' event only fires in OTHER tabs, so we need this custom event
    // to detect changes made within the same tab (e.g. admin page clicking "Impersonate").
    const handleChanged = () => setImpersonation(readStorage())
    window.addEventListener(IMPERSONATION_CHANGED_EVENT, handleChanged)

    // Also sync across tabs for completeness
    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setImpersonation(e.newValue ? JSON.parse(e.newValue) : null)
    }
    window.addEventListener("storage", handleStorage)

    return () => {
      window.removeEventListener(IMPERSONATION_CHANGED_EVENT, handleChanged)
      window.removeEventListener("storage", handleStorage)
    }
  }, [])

  const exitImpersonation = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY)
    setImpersonation(null)
    window.dispatchEvent(new Event(IMPERSONATION_CHANGED_EVENT))
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
