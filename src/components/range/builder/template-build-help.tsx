"use client"

import { useState } from "react"
import Link from "next/link"
import { useQueryClient } from "@tanstack/react-query"
import { Hammer, Loader2, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { queryKeys } from "@/lib/ui/query-keys"
import { useEffectiveScopeTag } from "@/lib/session/effective-scope-context"
import { convertVmToTemplate } from "@/lib/templates/template-proxmox-client"
import type { TemplateRow } from "./builder-types"

export function templateGuideHref(name: string, registered: boolean): string {
  const key = registered ? "build" : "add"
  return `/templates?${key}=${encodeURIComponent(name)}`
}

/** What to do about a template Ludus does not consider built. */
export function TemplateBuildHelp({
  name,
  row,
  className,
  quiet = false,
}: {
  name: string
  row?: TemplateRow
  className?: string
  /** Button only. The templates table has no room for the explanation. */
  quiet?: boolean
}) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const scopeTag = useEffectiveScopeTag()
  const [busy, setBusy] = useState(false)
  if (!name || row?.built) return null

  const convert = async () => {
    setBusy(true)
    try {
      await convertVmToTemplate(name)
      await queryClient.invalidateQueries({ queryKey: queryKeys.templates(scopeTag) })
      await queryClient.invalidateQueries({ queryKey: queryKeys.proxmoxTemplateGuests(scopeTag) })
      toast({
        title: "Converted to a template",
        description: `${name} can be cloned into a range.`,
      })
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not convert the VM",
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setBusy(false)
    }
  }

  if (row?.proxmox === "vm") {
    return (
      <div className={className}>
        {!quiet && (
          <p className="text-xs text-muted-foreground">
            Proxmox has a VM named {name}, but it is not a template. Ludus can only clone a template. This powers that VM off and converts it.
          </p>
        )}
        <Button type="button" size="sm" className={quiet ? "h-7 gap-1 px-2 text-[11px]" : "mt-2 gap-1.5"} disabled={busy} onClick={() => void convert()}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Hammer className="h-3.5 w-3.5" />}
          Convert to template
        </Button>
      </div>
    )
  }

  const registered = Boolean(row)
  return (
    <Button type="button" size="sm" variant="outline" className={className} asChild>
      <Link href={templateGuideHref(name, registered)}>
        {registered ? <Hammer className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
        {registered ? "Build this template" : "Add and install this template"}
      </Link>
    </Button>
  )
}
