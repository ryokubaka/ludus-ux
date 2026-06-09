"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { LogViewerCompound } from "@/components/range/log-viewer"
import {
  APP_LOG_PAGE_SIZE,
  appendAppLogStreamLines,
  MAX_APP_LOG_LOADED_LINES,
  parseAppLogLineTs,
  prependAppLogHistoryLines,
} from "@/lib/log-buffer"
import { Loader2 } from "lucide-react"

type LogFilter = "all" | "auth" | "app"
type LogSortOrder = "asc" | "desc"

function streamUrl(filter: LogFilter): string {
  if (filter === "all") return "/api/admin/app-logs/stream"
  return `/api/admin/app-logs/stream?category=${encodeURIComponent(filter)}`
}

function historyUrl(filter: LogFilter, before: number): string {
  const params = new URLSearchParams({
    before: String(before),
    limit: String(APP_LOG_PAGE_SIZE),
  })
  if (filter !== "all") params.set("category", filter)
  return `/api/admin/app-logs?${params}`
}

export function AdminAppLogsPageClient() {
  const [filter, setFilter] = useState<LogFilter>("all")
  const [lines, setLines] = useState<string[]>([])
  const [connected, setConnected] = useState(false)
  const [streamKey, setStreamKey] = useState(0)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasOlder, setHasOlder] = useState(true)
  const [sortOrder, setSortOrder] = useState<LogSortOrder>("desc")

  const reconnect = useCallback(() => {
    setStreamKey((k) => k + 1)
  }, [])

  useEffect(() => {
    setLines([])
    setConnected(false)
    setHasOlder(true)

    const es = new EventSource(streamUrl(filter))

    es.onopen = () => setConnected(true)
    es.onmessage = (event: MessageEvent<string>) => {
      const line = event.data.trim()
      if (!line || line.startsWith("[ERROR]")) return
      setLines((prev) => appendAppLogStreamLines(prev, line))
    }
    es.onerror = () => {
      if (es.readyState === EventSource.CONNECTING) {
        setConnected(false)
      }
    }

    return () => {
      es.close()
      setConnected(false)
    }
  }, [filter, streamKey])

  const loadOlder = useCallback(async () => {
    if (loadingOlder || !lines.length) return
    const before = parseAppLogLineTs(lines[0])
    if (before == null) return

    setLoadingOlder(true)
    try {
      const res = await fetch(historyUrl(filter, before))
      if (!res.ok) return
      const data = (await res.json()) as { lines?: string[] }
      const batch = data.lines ?? []
      if (batch.length < APP_LOG_PAGE_SIZE) setHasOlder(false)
      if (batch.length > 0) {
        setLines((prev) => prependAppLogHistoryLines(prev, [...batch].reverse()))
      }
    } finally {
      setLoadingOlder(false)
    }
  }, [filter, lines, loadingOlder])

  const atLoadedCap = lines.length >= MAX_APP_LOG_LOADED_LINES

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardHeader className="shrink-0 pb-3">
          <CardTitle className="text-lg">Application Logs</CardTitle>
          <p className="text-sm text-muted-foreground">
            Live sign-in events and application activity. Streams from the LUX server log store.
          </p>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden pb-4">
          <Tabs
            value={filter}
            onValueChange={(v) => setFilter(v as LogFilter)}
            className="shrink-0"
          >
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="auth">Auth</TabsTrigger>
              <TabsTrigger value="app">Application</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex min-h-0 flex-1 flex-col">
            <LogViewerCompound.Root
              lines={lines}
              live={connected}
              liveLabel="Application Logs"
              autoScroll
              fillHeight
              sortOrder={sortOrder}
              onSortOrderToggle={() => setSortOrder((o) => (o === "desc" ? "asc" : "desc"))}
              downloadFilename="lux-app-logs"
              onClear={() => setLines([])}
              onRefresh={reconnect}
              refreshLoading={!connected}
            >
              <LogViewerCompound.Toolbar />
              <LogViewerCompound.Search />
              <LogViewerCompound.Body />
            </LogViewerCompound.Root>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-3 text-xs text-muted-foreground pt-1">
            {!connected && <span>Connecting…</span>}
            {connected && (
              <span>
                Showing {lines.length} line{lines.length === 1 ? "" : "s"}
                {atLoadedCap ? ` (max ${MAX_APP_LOG_LOADED_LINES})` : ""}
                {sortOrder === "desc" ? " · newest first" : " · oldest first"}
              </span>
            )}
            {hasOlder && lines.length > 0 && !atLoadedCap && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={loadingOlder}
                onClick={() => void loadOlder()}
              >
                {loadingOlder ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    Loading…
                  </>
                ) : (
                  `Load older (${APP_LOG_PAGE_SIZE})`
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
