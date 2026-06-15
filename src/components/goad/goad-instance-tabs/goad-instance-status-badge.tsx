"use client"

import { Badge } from "@/components/ui/badge"

export function GoadInstanceStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "READY":
      return <Badge variant="success">Ready</Badge>
    case "PROVIDED":
      return <Badge variant="info">Provided</Badge>
    case "CREATED":
      return <Badge variant="warning">Created</Badge>
    default:
      return <Badge variant="secondary">{status}</Badge>
  }
}
