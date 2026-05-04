"use client"

import {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react"
import { fetchClientEffectiveScopeTag, readClientEffectiveScopeTagSync } from "@/lib/effective-scope"
import { IMPERSONATION_CHANGED_EVENT } from "@/lib/impersonation-context"

const EffectiveScopeContext = createContext<string>("_guest|self")

export function EffectiveScopeProvider({
  initialScopeTag,
  children,
}: {
  initialScopeTag: string
  children: React.ReactNode
}) {
  const [tag, setTag] = useState(initialScopeTag)

  useEffect(() => {
    setTag(initialScopeTag)
  }, [initialScopeTag])

  useEffect(() => {
    void fetchClientEffectiveScopeTag().then((next) => {
      setTag((prev) => (prev === next ? prev : next))
    })
  }, [])

  useEffect(() => {
    const onImp = () => {
      setTag(readClientEffectiveScopeTagSync())
      void fetchClientEffectiveScopeTag().then(setTag)
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key === "goad_impersonation" || e.key === "ludus-auth-username") {
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
