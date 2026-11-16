"use client"

import { useEffect, useMemo, useState } from "react"
import {
  ArrowRightLeft,
  BookOpen,
  Bug,
  Minus,
  OctagonAlert,
  Plus,
  Search,
  ShieldAlert,
  X,
  Zap,
} from "lucide-react"
import type { LucideProps } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/core/utils"
import { statusBadge } from "@/lib/ui/status-colors"

type TagMeta = { label: string; className: string; Icon: React.FC<LucideProps> }

const TAG_META: Record<string, TagMeta> = {
  add: { label: "Add", Icon: Plus, className: statusBadge("success") },
  fix: { label: "Fix", Icon: Bug, className: statusBadge("info") },
  improve: { label: "Enhance", Icon: Zap, className: statusBadge("warning") },
  perf: { label: "Perf", Icon: Zap, className: `${statusBadge("info")} border-primary/30 text-primary` },
  security: { label: "Security", Icon: ShieldAlert, className: statusBadge("error") },
  remove: { label: "Remove", Icon: Minus, className: statusBadge("aborted") },
  breaking: { label: "Breaking", Icon: OctagonAlert, className: statusBadge("error") },
  docs: { label: "Docs", Icon: BookOpen, className: statusBadge("neutral") },
}

const TAG_FILTER_ORDER = ["add", "improve", "fix", "security", "perf", "docs", "remove", "breaking"] as const

const GROUP_COLORS: Record<string, string> = {
  LUX: "text-primary border-primary/40 bg-primary/10",
  GOAD: "text-status-aborted border-orange-400/40 bg-orange-400/10",
}

export interface ChangelogEntry {
  tag: string
  text: string
}

export interface ChangelogGroup {
  name: string | null
  entries: ChangelogEntry[]
}

export interface ChangelogVersion {
  title: string
  date: string
  groups: ChangelogGroup[]
}

export function changelogVersionKey(title: string): string {
  return title.match(/(\d+\.\d+\.\d+)/)?.[1] ?? ""
}

export function parseChangelog(md: string): ChangelogVersion[] {
  const text = md.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  const lines = text.split("\n")
  const versions: ChangelogVersion[] = []
  let current: ChangelogVersion | null = null
  let currentGroup: ChangelogGroup | null = null

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (current) versions.push(current)
      const title = line.replace(/^## /, "").trim()
      const dateMatch = title.match(/(\d{4}-\d{2}-\d{2})/)
      current = { title, date: dateMatch?.[1] ?? "", groups: [] }
      currentGroup = null
      continue
    }
    if (!current) continue
    const groupMatch = /^\*\*(.+?)\*\*$/.exec(line.trim())
    if (groupMatch) {
      currentGroup = { name: groupMatch[1], entries: [] }
      current.groups.push(currentGroup)
      continue
    }
    const m = line.match(/^-\s+\*{0,2}\[([^\]]+)\]\*{0,2}\s+(.+)$/)
    if (m) {
      if (!currentGroup) {
        currentGroup = { name: null, entries: [] }
        current.groups.push(currentGroup)
      }
      currentGroup.entries.push({ tag: m[1].toLowerCase(), text: m[2].trim() })
    }
  }
  if (current) versions.push(current)
  return versions
}

function allEntries(version: ChangelogVersion): ChangelogEntry[] {
  return version.groups.flatMap((group) => group.entries)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function entryMatchesQuery(
  entry: ChangelogEntry,
  groupName: string | null,
  version: ChangelogVersion,
  query: string,
): boolean {
  const meta = TAG_META[entry.tag]
  const haystacks = [entry.text, entry.tag, meta?.label ?? "", groupName ?? "", version.title, version.date]
  return haystacks.some((value) => value.toLowerCase().includes(query))
}

function filterChangelogByTag(versions: ChangelogVersion[], tag: string | null): ChangelogVersion[] {
  if (!tag) return versions
  const out: ChangelogVersion[] = []
  for (const version of versions) {
    const groups: ChangelogGroup[] = []
    for (const group of version.groups) {
      const entries = group.entries.filter((entry) => entry.tag === tag)
      if (entries.length > 0) groups.push({ ...group, entries })
    }
    if (groups.length > 0) out.push({ ...version, groups })
  }
  return out
}

function filterChangelogVersions(versions: ChangelogVersion[], query: string): ChangelogVersion[] {
  const q = query.trim().toLowerCase()
  if (!q) return versions
  const out: ChangelogVersion[] = []
  for (const version of versions) {
    const titleMatch = version.title.toLowerCase().includes(q) || version.date.toLowerCase().includes(q)
    if (titleMatch) {
      out.push(version)
      continue
    }
    const groups: ChangelogGroup[] = []
    for (const group of version.groups) {
      const groupNameMatch = (group.name ?? "").toLowerCase().includes(q)
      const entries = groupNameMatch ? group.entries : group.entries.filter((entry) => entryMatchesQuery(entry, group.name, version, q))
      if (entries.length > 0) groups.push({ ...group, entries })
    }
    if (groups.length > 0) out.push({ ...version, groups })
  }
  return out
}

function changelogTagCounts(versions: ChangelogVersion[]): Record<string, number> {
  const acc: Record<string, number> = {}
  for (const version of versions) {
    for (const entry of allEntries(version)) acc[entry.tag] = (acc[entry.tag] ?? 0) + 1
  }
  return acc
}

function renderPlainWithHighlight(text: string, query: string, keyPrefix: string) {
  const q = query.trim()
  if (!q) return <>{text}</>
  const parts = text.split(new RegExp(`(${escapeRegExp(q)})`, "gi"))
  const qLower = q.toLowerCase()
  return (
    <>
      {parts.map((part, i) =>
        part && part.toLowerCase() === qLower ? (
          <mark key={`${keyPrefix}-${i}`} className="bg-primary/25 text-foreground rounded-sm px-0.5">
            {part}
          </mark>
        ) : (
          <span key={`${keyPrefix}-${i}`}>{part}</span>
        ),
      )}
    </>
  )
}

function renderInline(text: string, highlightQuery = "") {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/)
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-medium text-foreground">
          {highlightQuery ? renderPlainWithHighlight(part.slice(2, -2), highlightQuery, `b-${i}`) : part.slice(2, -2)}
        </strong>
      )
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={i} className="text-primary text-[11px] bg-muted px-1 py-0.5 rounded">
          {highlightQuery ? renderPlainWithHighlight(part.slice(1, -1), highlightQuery, `c-${i}`) : part.slice(1, -1)}
        </code>
      )
    }
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (link) {
      return (
        <a key={i} href={link[2]} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 hover:text-primary/80">
          {highlightQuery ? renderPlainWithHighlight(link[1], highlightQuery, `l-${i}`) : link[1]}
        </a>
      )
    }
    return highlightQuery ? (
      <span key={i}>{renderPlainWithHighlight(part, highlightQuery, `t-${i}`)}</span>
    ) : (
      <span key={i}>{part}</span>
    )
  })
}

export function ChangelogVersionBody({ version, highlight = "" }: { version: ChangelogVersion; highlight?: string }) {
  const entries = allEntries(version)
  const tagCounts = entries.reduce<Record<string, number>>((acc, entry) => {
    acc[entry.tag] = (acc[entry.tag] ?? 0) + 1
    return acc
  }, {})
  const hasGroups = version.groups.some((group) => group.name !== null)
  const hl = highlight.trim()
  return (
    <div className="mt-2 space-y-1.5 pl-5">
      <div className="mb-3 flex flex-wrap gap-1">
        {Object.entries(tagCounts).map(([tag, count]) => {
          const meta = TAG_META[tag]
          if (!meta) return null
          return (
            <span key={tag} className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium ${meta.className}`}>
              <meta.Icon className="h-2.5 w-2.5" />
              {meta.label} {count}
            </span>
          )
        })}
      </div>
      {hasGroups ? (
        <div className="space-y-3">
          {version.groups.map((group, gi) => (
            <div key={gi}>
              {group.name && (
                <div className="mb-1.5 flex items-center gap-2">
                  <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold tracking-wide ${GROUP_COLORS[group.name] ?? "text-muted-foreground border-border bg-muted"}`}>
                    {group.name}
                  </span>
                  <div className="h-px flex-1 bg-border/40" />
                </div>
              )}
              <div className="space-y-1.5">
                {group.entries.map((entry, ei) => {
                  const meta: TagMeta = TAG_META[entry.tag] ?? { label: entry.tag, Icon: ArrowRightLeft, className: "bg-muted text-muted-foreground border-border" }
                  return (
                    <div key={ei} className="flex items-start gap-2 text-xs">
                      <span className={`mt-0.5 inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold leading-none ${meta.className}`}>
                        <meta.Icon className="h-2.5 w-2.5" />
                        {meta.label}
                      </span>
                      <span className="leading-relaxed text-muted-foreground">{renderInline(entry.text, hl)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-1.5">
          {entries.map((entry, ei) => {
            const meta: TagMeta = TAG_META[entry.tag] ?? { label: entry.tag, Icon: ArrowRightLeft, className: "bg-muted text-muted-foreground border-border" }
            return (
              <div key={ei} className="flex items-start gap-2 text-xs">
                <span className={`mt-0.5 inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold leading-none ${meta.className}`}>
                  <meta.Icon className="h-2.5 w-2.5" />
                  {meta.label}
                </span>
                <span className="leading-relaxed text-muted-foreground">{renderInline(entry.text, hl)}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function useChangelogNotes() {
  const [raw, setRaw] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [tagFilter, setTagFilter] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/changelog")
      .then((res) => {
        if (!res.ok) throw new Error()
        return res.text()
      })
      .then(setRaw)
      .catch(() => setError(true))
  }, [])

  const versions = useMemo(() => (raw ? parseChangelog(raw) : []), [raw])
  const tagCounts = useMemo(() => changelogTagCounts(versions), [versions])
  const filtered = useMemo(() => {
    return filterChangelogVersions(filterChangelogByTag(versions, tagFilter), searchQuery)
  }, [versions, tagFilter, searchQuery])
  const byVersion = useMemo(() => {
    const map = new Map<string, ChangelogVersion>()
    for (const version of filtered) {
      const key = changelogVersionKey(version.title)
      if (key) map.set(key, version)
    }
    return map
  }, [filtered])
  const filterActive = searchQuery.trim().length > 0 || tagFilter != null
  const matchCount = filtered.reduce((sum, version) => sum + allEntries(version).length, 0)

  return {
    error,
    ready: raw != null,
    searchQuery,
    setSearchQuery,
    tagFilter,
    setTagFilter,
    tagCounts,
    filterActive,
    byVersion,
    matchCount,
  }
}

export function ChangelogNoteFilters({
  notes,
}: {
  notes: ReturnType<typeof useChangelogNotes>
}) {
  return (
    <div className="space-y-3 border-b border-border/50 px-4 py-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          role="searchbox"
          placeholder="Search release notes…"
          value={notes.searchQuery}
          onChange={(e) => notes.setSearchQuery(e.target.value)}
          className="h-8 pl-8 pr-8 text-sm"
          aria-label="Search release notes"
        />
        {notes.searchQuery && (
          <button
            type="button"
            onClick={() => notes.setSearchQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by change type">
        <button
          type="button"
          onClick={() => notes.setTagFilter(null)}
          className={cn(
            "rounded border px-2 py-0.5 text-[10px] font-medium transition-colors",
            notes.tagFilter === null
              ? "border-primary/50 bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:border-primary/30 hover:text-foreground",
          )}
        >
          All
        </button>
        {TAG_FILTER_ORDER.map((tag) => {
          const count = notes.tagCounts[tag]
          const meta = TAG_META[tag]
          if (!count || !meta) return null
          const selected = notes.tagFilter === tag
          return (
            <button
              key={tag}
              type="button"
              onClick={() => notes.setTagFilter(selected ? null : tag)}
              aria-pressed={selected}
              className={cn(
                "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                selected ? "ring-1 ring-primary/40" : "opacity-80 hover:opacity-100",
                meta.className,
              )}
            >
              <meta.Icon className="h-2.5 w-2.5" />
              {meta.label}
              <span className="opacity-70">{count}</span>
            </button>
          )
        })}
      </div>
      {notes.filterActive && notes.matchCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {notes.matchCount} change{notes.matchCount === 1 ? "" : "s"}
        </p>
      )}
    </div>
  )
}
