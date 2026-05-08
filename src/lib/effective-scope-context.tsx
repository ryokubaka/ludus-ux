"use client"

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
} from "react"
import { fetchClientEffectiveScopeTag, readClientEffectiveScopeTagSync } from "@/lib/effective-scope"
import { IMPERSONATION_CHANGED_EVENT } from "@/lib/impersonation-context"
import { IMPERSONATION_STORAGE_KEY } from "@/lib/impersonation-headers"

const EffectiveScopeContext = createContext<string>("_guest|self")

export function EffectiveScopeProvider({
  initialScopeTag,
  children,
}: {
  initialScopeTag: string
  children: React.ReactNode
}) {
  const [tag, setTag] = useState(initialScopeTag)

  // Do not reset with `setTag(initialScopeTag)` on every layout prop change —
  // that runs after this layout pass and would clobber sessionStorage-driven
  // impersonation (SSR cookie often `…|self` while storage already has `…|user`).

  // SessionStorage impersonation can differ from SSR cookie scope until
  // /api/auth/impersonate finishes — apply the sync tag immediately so query
  // keys and RangeProvider match the browser's effective identity.
  useLayoutEffect(() => {
    const sync = readClientEffectiveScopeTagSync()
    if (sync !== initialScopeTag) setTag(sync)
  }, [initialScopeTag])

  useEffect(() => {
    const sync = readClientEffectiveScopeTagSync()
    setTag((prev) => (sync === initialScopeTag ? initialScopeTag : prev))
  }, [initialScopeTag])

  useEffect(() => {
    void fetchClientEffectiveScopeTag().then((next) => {
      setTag((prev) => (prev === next ? prev : next))
    })
  }, [initialScopeTag])

  useLayoutEffect(() => {
    const onImp = () => {
      const sync = readClientEffectiveScopeTagSync()
      setTag(sync)
      void fetchClientEffectiveScopeTag().then(setTag)
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key === IMPERSONATION_STORAGE_KEY || e.key === "ludus-auth-username") {
        setTag(readClientEffectiveScopeTagSync())
        void fetchClientEffectiveScopeTag().then(setTag)
      }
    }
    window.addEventListener(IMPERSONATION_CHANGED_EVENT, onImp)
    window.addEventListener("storage", onStorage)
    return () => {
      window.removeEventListener(IMPERSONATION_CHANGED_EVENT, onImp)
      window.removeEventListener("storage", onStorage)
    }
  }, [])

  return (
    <EffectiveScopeContext.Provider value={tag}>
      {children}
    </EffectiveScopeContext.Provider>
  )
}

export function useEffectiveScopeTag(): string {
  return useContext(EffectiveScopeContext)
}
