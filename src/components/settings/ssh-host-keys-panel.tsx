"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { KeyRound, Loader2 } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"

type StoredKey = { host: string; port: number; fingerprint: string }
type HostKeysResponse = { pinned: boolean; keys: StoredKey[] }

const HOST_KEYS_QUERY = ["settings", "ssh-host-keys"] as const

async function fetchHostKeys(): Promise<HostKeysResponse> {
  const res = await fetch("/api/settings/ssh-host-key", { credentials: "include", cache: "no-store" })
  if (!res.ok) throw new Error(`Could not read stored host keys (HTTP ${res.status})`)
  return (await res.json()) as HostKeysResponse
}

/** Stored trust-on-first-use host keys. Forgetting one lets the next connection pin the new key. */
export function SshHostKeysPanel() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [forgetting, setForgetting] = useState<string | null>(null)
  const { data, error, isLoading } = useQuery({ queryKey: HOST_KEYS_QUERY, queryFn: fetchHostKeys })

  async function forget(key: StoredKey) {
    const id = `${key.host}:${key.port}`
    setForgetting(id)
    try {
      const res = await fetch("/api/settings/ssh-host-key", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host: key.host, port: key.port }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      toast({ title: "Host key forgotten", description: `The next connection to ${id} stores its current key.` })
      await queryClient.invalidateQueries({ queryKey: HOST_KEYS_QUERY })
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not forget the host key",
        description: err instanceof Error ? err.message : "Network error",
      })
    } finally {
      setForgetting(null)
    }
  }

  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5">
        <KeyRound className="h-3.5 w-3.5" />
        Stored SSH host keys
      </Label>
      {data?.pinned ? (
        <p className="text-xs text-muted-foreground">
          LUX_SSH_HOST_KEY is set, so every connection must match that pin. Stored keys below are not used.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          The first key seen for a host is kept, and a different key is refused. Forget a key only after confirming the
          host was rebuilt or its key was rotated.
        </p>
      )}
      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : error ? (
        <p className="text-xs text-destructive">{error instanceof Error ? error.message : "Could not read stored host keys"}</p>
      ) : data && data.keys.length === 0 ? (
        <p className="text-xs text-muted-foreground">No host keys stored yet.</p>
      ) : (
        <ul className="space-y-1">
          {data?.keys.map((key) => {
            const id = `${key.host}:${key.port}`
            return (
              <li key={id} className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1">
                <span className="min-w-0 font-mono text-xs">
                  <span className="text-foreground">{id}</span>{" "}
                  <span className="break-all text-muted-foreground">{key.fingerprint}</span>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={forgetting !== null}
                  onClick={() => void forget(key)}
                >
                  {forgetting === id ? <Loader2 className="animate-spin" /> : null}
                  Forget
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
