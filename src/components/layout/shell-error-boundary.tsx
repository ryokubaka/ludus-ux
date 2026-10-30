"use client"

import { Component, type ReactNode } from "react"
import { reloadDocument, reloadDocumentOnce } from "@/lib/ui/document-reload"

type ShellErrorBoundaryProps = { children: ReactNode }
type ShellErrorBoundaryState = { error: Error | null }

/**
 * Catches a throw in the root providers. Those sit above the page error
 * boundary, so without this a refresh replaces the document with global-error.
 */
export class ShellErrorBoundary extends Component<ShellErrorBoundaryProps, ShellErrorBoundaryState> {
  state: ShellErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ShellErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error): void {
    console.error("Shell error:", error)
    if (process.env.NODE_ENV === "production") reloadDocumentOnce()
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-[100dvh] items-center justify-center bg-background p-6 text-center">
          <div>
            <h1 className="text-lg font-semibold">Something went wrong</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {process.env.NODE_ENV === "production"
                ? "The page failed to load. Reload to open it again."
                : this.state.error.message}
            </p>
            <button
              type="button"
              className="mt-4 rounded-md border px-4 py-2 text-sm"
              onClick={() => reloadDocument()}
            >
              Reload
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
