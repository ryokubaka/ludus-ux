"use client"

import { Copy, Download, FileText, Loader2, RefreshCw } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { TabsContent } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import type { GoadInventoriesTabProps } from "./types"

export function GoadInventoriesTab({
  active,
  instanceId,
  inventories,
  inventoriesLoading,
  inventoriesError,
  selectedInventoryName,
  setSelectedInventoryName,
  fetchInventories,
  copyInventoryToClipboard,
  downloadInventory,
}: GoadInventoriesTabProps) {
  return (
    <TabsContent value="inventories" className="mt-4 flex flex-col min-h-0 flex-1 overflow-y-auto">
      {active ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Inventory files in <code className="text-primary">workspace/{instanceId}</code> (base +
              each extension).
            </p>
            <Button size="sm" variant="ghost" onClick={fetchInventories} disabled={inventoriesLoading}>
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", inventoriesLoading && "animate-spin")} />
              {inventoriesLoading ? "Loading..." : "Refresh"}
            </Button>
          </div>
          {inventoriesError && (
            <Alert variant="destructive">
              <AlertDescription>{inventoriesError}</AlertDescription>
            </Alert>
          )}
          {inventoriesLoading && inventories.length === 0 ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : inventories.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No inventory files found. Run Provide to create the workspace.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-1 space-y-1">
                {inventories.map((inv) => (
                  <Button
                    key={inv.name}
                    variant={selectedInventoryName === inv.name ? "secondary" : "ghost"}
                    size="sm"
                    className="w-full justify-start font-mono text-xs"
                    onClick={() => setSelectedInventoryName(inv.name)}
                  >
                    <FileText className="h-3.5 w-3.5 mr-2 flex-shrink-0" />
                    {inv.name}
                  </Button>
                ))}
              </div>
              <div className="md:col-span-2">
                {selectedInventoryName &&
                  (() => {
                    const inv = inventories.find((i) => i.name === selectedInventoryName)
                    if (!inv) return null
                    return (
                      <Card>
                        <CardHeader className="pb-2 flex flex-row items-center justify-between">
                          <CardTitle className="text-sm font-mono">{inv.name}</CardTitle>
                          <div className="flex gap-1">
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              title="Copy"
                              onClick={() => copyInventoryToClipboard(inv.content, inv.name)}
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              title="Download"
                              onClick={() => downloadInventory(inv.content, inv.name)}
                            >
                              <Download className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </CardHeader>
                        <CardContent className="p-0">
                          <pre className="p-3 text-xs font-mono overflow-auto max-h-[60vh] bg-muted/30 rounded-b-lg whitespace-pre-wrap break-all">
                            {inv.content || "(empty)"}
                          </pre>
                        </CardContent>
                      </Card>
                    )
                  })()}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </TabsContent>
  )
}
