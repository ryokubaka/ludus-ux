"use client"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export function DeployApprovalDialog(props: {
  open: boolean
  title: string
  note: string
  yaml: string
  confirmLabel: string
  onCancel: () => void
  onApprove: () => void
}) {
  const ready = props.yaml.trim().length > 0
  return (
    <Dialog open={props.open} onOpenChange={(open) => { if (!open) props.onCancel() }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription>{props.note}</DialogDescription>
        </DialogHeader>
        <pre
          aria-label="Range configuration"
          className="max-h-[min(50vh,28rem)] overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed whitespace-pre"
        >
          {ready ? props.yaml : "The configuration is not ready yet."}
        </pre>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={props.onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={props.onApprove} disabled={!ready}>
            {props.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
