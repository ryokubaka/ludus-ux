"use client"

import { Loader2, UserCog, X } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { GoadReassignDialogProps } from "./types"

export function GoadReassignDialog({
  open,
  instance,
  reassignUsers,
  reassignTargetUser,
  reassignTargetRange,
  reassigning,
  onClose,
  onTargetUserChange,
  onTargetRangeChange,
  onSubmit,
}: GoadReassignDialogProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <Card className="w-full max-w-md shadow-2xl border-blue-500/30">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <UserCog className="h-4 w-4 text-status-info" />
              Re-assign Instance
            </CardTitle>
            <Button size="icon-sm" variant="ghost" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertDescription className="text-xs">
              This will change the OS-level file owner of the GOAD workspace on the server and reassign the
              associated Ludus range to the target user.
            </AlertDescription>
          </Alert>
          <div className="space-y-1.5">
            <Label className="text-xs">Target User</Label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
              value={reassignTargetUser}
              onChange={(e) => onTargetUserChange(e.target.value)}
            >
              <option value="">— select user —</option>
              {reassignUsers.map((u) => (
                <option key={u.userID} value={u.userID}>
                  {u.userID}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Ludus Range ID (optional — leave blank to keep current)</Label>
            <Input
              className="font-mono text-xs"
              placeholder={instance.ludusRangeId ?? "e.g. user1-GOAD-Mini-ABC123"}
              value={reassignTargetRange}
              onChange={(e) => onTargetRangeChange(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Current: <code className="text-primary">{instance.ludusRangeId ?? "none"}</code>
            </p>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={onSubmit}
              disabled={!reassignTargetUser || reassigning}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {reassigning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <UserCog className="h-3.5 w-3.5" />
              )}
              Re-assign
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
