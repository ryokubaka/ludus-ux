"use client"

import { useEffect, useState, useMemo } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Loader2, ChevronRight } from "lucide-react"
import { APP_VERSION, APP_VERSION_LABEL } from "@/lib/changelog"

/**
 * Render inline markdown fragments: **bold**, `code`, and [links](url).
 */
function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/)
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={i} className="text-primary text-[11px] bg-muted px-1 py-0.5 rounded">{part.slice(1, -1)}</code>
    }
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (linkMatch) {
      return <a key={i} href={linkMatch[2]} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 hover:text-primary/80">{linkMatch[1]}</a>
    }
    return <span key={i}>{part}</span>
  })
}

const sectionColors: Record<string, string> = {
  Added: "text-green-400",
  Fixed: "text-blue-400",
  Changed: "text-yellow-400",
  Security: "text-red-400",
}

interface ChangelogDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ChangelogDialog({ open, onOpenChange }: ChangelogDialogProps) {
  const [raw, setRaw] = useState<string | null>(null)
  const [error, setError] = useState(false)
  // Only the most recent version is expanded by default; users can click
  // older entries to reveal their contents.
  const [expanded, setExpanded] = useState<Record<number, boolean>>({ 0: true })

  useEffect(() => {
    if (!open || raw !== null) return
    fetch("/api/changelog")
      .then((r) => {
        if (!r.ok) throw new Error()
        return r.text()
      })
      .then(setRaw)
      .catch(() => setError(true))
  }, [open, raw])

  const versions = useMemo(() => (raw ? parseChangelog(raw) : []), [raw])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/50 shrink-0">
          <DialogTitle className="flex items-center gap-2">
            Changelog
            <Badge variant="outline" className="text-xs font-mono">
              v{APP_VERSION} {APP_VERSION_LABEL}
            </Badge>
          </DialogTitle>
          <DialogDescription className="text-xs">
            Release history for LUX (Ludus UX)
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="px-6 py-4">
            {!raw && !error && (
              <div className="flex items-center justify-center py-8 text-muted-foreground gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Loading changelog…</span>
              </div>
            )}
            {error && (
              <p className="text-sm text-destructive py-8 text-center">Could not load changelog.</p>
            )}
            {versions.length > 0 && (
              <div className="divide-y divide-border/40">
                {versions.map((v, vi) => {
                  const isOpen = !!expanded[vi]
                  return (
                    <div key={vi} className={vi === 0 ? "pb-3" : "py-3"}>
                      <button
                        type="button"
                        onClick={() =>
                          setExpanded((prev) => ({ ...prev, [vi]: !prev[vi] }))
                        }
                        className="w-full flex items-center gap-2 text-left py-1 hover:text-primary transition-colors group"
                        aria-expanded={isOpen}
                      >
                        <ChevronRight
                          className={`h-3.5 w-3.5 text-muted-foreground/70 transition-transform shrink-0 ${
                            isOpen ? "rotate-90" : ""
                          }`}
                        />
                        <h3 className="text-sm font-semibold text-foreground group-hover:text-primary">
                          {v.title}
                        </h3>
                      </button>
                      {isOpen && (
                        <div className="mt-2 pl-5">
                          {v.sections.map((s, si) => (
                            <div key={si} className="mb-2">
                              <h4
                                className={`text-xs font-semibold mb-1 ${sectionColors[s.heading] ?? "text-muted-foreground"}`}
                              >
                                {s.heading}
                              </h4>
                              {renderSectionItems(s.items)}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* ── Minimal Keep-a-Changelog parser ─────────────────────────────────── */

type SectionItem = { kind: "bullet"; text: string } | { kind: "sub"; text: string }

interface ParsedSection {
  heading: string
  items: SectionItem[]
}

interface ParsedVersion {
  title: string
  sections: ParsedSection[]
}

function parseChangelog(md: string): ParsedVersion[] {
  const lines = md.split("\n")
  const versions: ParsedVersion[] = []
  let current: ParsedVersion | null = null
  let currentSection: ParsedSection | null = null

  for (const line of lines) {
    // ## [0.9.4] — Beta — 2026-04-15
    if (line.startsWith("## ")) {
      if (current) versions.push(current)
      current = { title: line.replace(/^## /, "").trim(), sections: [] }
      currentSection = null
      continue
    }
    // ### Added / ### Fixed / etc.
    if (line.startsWith("### ") && current) {
      currentSection = { heading: line.replace(/^### /, "").trim(), items: [] }
      current.sections.push(currentSection)
      continue
    }
    if (!currentSection) continue
    // - bullet
    if (line.startsWith("- ")) {
      currentSection.items.push({ kind: "bullet", text: line.slice(2) })
      continue
    }
    // **Group heading** on its own line — used inside Added/Fixed/Changed
    // to visually chunk long sections (GOAD / History / …).
    const trimmed = line.trim()
    const m = /^\*\*(.+?)\*\*$/.exec(trimmed)
    if (m) {
      currentSection.items.push({ kind: "sub", text: m[1] })
      continue
    }
  }
  if (current) versions.push(current)
  return versions
}

/**
 * Render a flat stream of bullets and in-section sub-headers into grouped
 * `<ul>` blocks, so `**Group**` lines inside a section become visible labels
 * without breaking HTML (can't nest `<p>` inside `<ul>`).
 */
function renderSectionItems(items: SectionItem[]): React.ReactNode {
  const out: React.ReactNode[] = []
  let bucket: string[] = []
  const flush = (key: string) => {
    if (bucket.length === 0) return
    const items = bucket
    bucket = []
    out.push(
      <ul key={key} className="space-y-0.5">
        {items.map((text, ii) => (
          <li
            key={ii}
            className="text-xs text-muted-foreground leading-relaxed pl-3 relative before:content-['•'] before:absolute before:left-0 before:text-muted-foreground/40"
          >
            {renderInline(text)}
          </li>
        ))}
      </ul>
    )
  }

  items.forEach((it, i) => {
    if (it.kind === "sub") {
      flush(`ul-${i}`)
      out.push(
        <p
          key={`sub-${i}`}
          className="text-[11px] font-semibold text-foreground/80 mt-2 first:mt-0 mb-0.5 uppercase tracking-wide"
        >
          {it.text}
        </p>
      )
    } else {
      bucket.push(it.text)
    }
  })
  flush("ul-end")

  return <>{out}</>
}
