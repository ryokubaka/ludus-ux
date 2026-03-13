"use client"

import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { AlertTriangle, RefreshCw } from "lucide-react"

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("Page error:", error)
  }, [error])

  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Card className="max-w-md w-full">
        <CardContent className="flex flex-col items-center py-12 text-center">
          <div className="h-14 w-14 rounded-full bg-red-500/20 flex items-center justify-center mb-4">
            <AlertTriangle className="h-7 w-7 text-red-400" />
          </div>
          <h2 className="text-lg font-semibold mb-2">Something went wrong</h2>
          <p className="text-sm text-muted-foreground mb-1">{error.message}</p>
          {error.digest && (
            <code className="text-xs text-muted-foreground/60 mt-1 mb-4">{error.digest}</code>
          )}
          <Button onClick={reset} className="mt-4">
            <RefreshCw className="h-4 w-4" />
            Try Again
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
