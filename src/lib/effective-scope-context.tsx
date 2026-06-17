"use client"

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
} from "react"
import { fetchClientEffectiveScopeTag, readClientEffectiveScopeTagSync } from "@/lib/effective-scope"
import { AUTH_CHANGED_EVENT } from "@/lib/client-auth-state"
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

  // Three-layer hydration — each layer is more authoritative than the last:
  //
  //  1. SSR baseline: `initialScopeTag` from the server (cookie scope at render time).
  //     This is the starting value of `tag` and is good enough for the first paint.
  //
  //  2. sessionStorage fast-path (useLayoutEffect — runs before paint): if the
  //     browser already has a different impersonation identity in sessionStorage
  //     (e.g. the user just switched targets), apply it synchronously so query
  //     keys and RangeProvider see the correct scope before any data fetches fire.
  //     The SSR cookie often lags by one round-trip on user switch.
  //
  //  3. Authoritative async fetch (useEffect): /api/auth/session + /api/auth/impersonate
  //     give the definitive cookie-side identity. This overwrites the sync value once
  //     the responses arrive.
  //
  // Do NOT reset to `initialScopeTag` on every prop change — that would clobber
  // a storage-driven impersonation that is already correct.

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
    const onAuth = () => {
      setTag(readClientEffectiveScopeTagSync())
      void fetchClientEffectiveScopeTag().then(setTag)
    }
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
    window.addEventListener(AUTH_CHANGED_EVENT, onAuth)
    window.addEventListener(IMPERSONATION_CHANGED_EVENT, onImp)
    window.addEventListener("storage", onStorage)
    return () => {
      window.removeEventListener(AUTH_CHANGED_EVENT, onAuth)
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
