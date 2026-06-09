"use client"

import Link from "next/link"
import { ArrowLeft, RefreshCw, Server, User, Wifi } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { GoadInstanceStatusBadge } from "./goad-instance-status-badge"
import type { GoadInstanceHeaderProps } from "./types"

export function GoadInstanceHeader({ instance, loading, refreshing, onRefresh }: GoadInstanceHeaderProps) {
  return (
    <div className="flex items-center gap-3 flex-shrink-0">
      <Button variant="ghost" size="icon-sm" asChild>
        <Link href="/goad">
          <ArrowLeft className="h-4 w-4" />
        </Link>
      </Button>
      <div className="flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-lg font-mono font-bold">{instance.instanceId}</h2>
          <Badge variant="secondary">{instance.lab}</Badge>
          <GoadInstanceStatusBadge status={instance.status} />
          {instance.isDefault && <Badge variant="cyan">Default</Badge>}
        </div>
        <div className="flex gap-4 mt-1 flex-wrap">
          {instance.ownerUserId && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <User className="h-3 w-3" /> {instance.ownerUserId}
            </span>
          )}
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Wifi className="h-3 w-3" /> {instance.ipRange || "IP not yet assigned"}
          </span>
          {instance.ludusRangeId ? (
            <span
              className="text-xs text-status-success flex items-center gap-1"
              title="This instance has its own dedicated Ludus range — destroying it will not affect other ranges"
            >
              <Server className="h-3 w-3" />
              range: <code className="ml-0.5">{instance.ludusRangeId}</code>
            </span>
          ) : (
            <span
              className="text-xs text-status-warning flex items-center gap-1"
              title="No dedicated range yet — click Provide to create an isolated range for this instance"
            >
              <Server className="h-3 w-3" />
              {instance.provider} / {instance.provisioner} (no dedicated range)
            </span>
          )}
        </div>
      </div>
      <Button variant="ghost" size="icon-sm" onClick={onRefresh} disabled={loading || refreshing}>
        <RefreshCw className={cn("h-4 w-4", (loading || refreshing) && "animate-spin")} />
      </Button>
    </div>
  )
}
