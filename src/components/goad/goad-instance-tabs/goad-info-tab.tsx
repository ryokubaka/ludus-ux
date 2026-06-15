"use client"

import { FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { TabsContent } from "@/components/ui/tabs"
import type { GoadInfoTabProps } from "./types"

export function GoadInfoTab({ instance, instanceId, labInfo, onViewInventories }: GoadInfoTabProps) {
  return (
    <TabsContent value="info" className="mt-4 flex flex-col min-h-0 flex-1 overflow-y-auto">
      <div className="space-y-4">
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="p-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary flex-shrink-0" />
              <div>
                <p className="text-sm font-medium">GOAD compiled inventories</p>
                <p className="text-xs text-muted-foreground">
                  Base inventory and extension inventories for this instance (workspace/{instanceId})
                </p>
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={onViewInventories}>
              <FileText className="h-3.5 w-3.5 mr-1.5" />
              View inventories
            </Button>
          </CardContent>
        </Card>
        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Lab Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {[
                ["Lab", instance.lab],
                ["Instance ID", instance.instanceId],
                ["Status", instance.status],
                ["IP Range", instance.ipRange || "Not assigned"],
                ["Provider", instance.provider],
                ["Provisioner", instance.provisioner],
              ].map(([key, val]) => (
                <div key={key} className="flex justify-between">
                  <span className="text-muted-foreground text-xs">{key}</span>
                  <code className="font-mono text-xs">{val}</code>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Lab Description</CardTitle>
            </CardHeader>
            <CardContent>
              {labInfo ? (
                <div className="space-y-2">
                  {labInfo.description && (
                    <p className="text-xs text-muted-foreground">{labInfo.description}</p>
                  )}
                  <div className="grid grid-cols-2 gap-2 mt-3">
                    <div className="text-center p-2 bg-muted/50 rounded-md">
                      <p className="text-lg font-bold">{labInfo.vmCount}</p>
                      <p className="text-xs text-muted-foreground">VMs</p>
                    </div>
                    <div className="text-center p-2 bg-muted/50 rounded-md">
                      <p className="text-lg font-bold">{labInfo.domains}</p>
                      <p className="text-xs text-muted-foreground">Domains</p>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No description available</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </TabsContent>
  )
}
