"use client"

import { RouteSegmentError } from "@/components/route-segment-error"

export default function TestingError(props: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <RouteSegmentError {...props} />
}
