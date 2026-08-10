import { describe, expect, it } from "vitest"
import {
  isGitBackedSource,
  isSourceSyncStale,
  parseSourceSyncedAtMs,
  sourceIdOf,
} from "@/lib/source-auto-sync"

describe("source-auto-sync", () => {
  it("parses lastSyncedAt", () => {
    expect(parseSourceSyncedAtMs("")).toBeNull()
    expect(parseSourceSyncedAtMs("not-a-date")).toBeNull()
    const ms = parseSourceSyncedAtMs("2026-08-09T16:00:00.000Z")
    expect(ms).toBe(Date.parse("2026-08-09T16:00:00.000Z"))
  })

  it("identifies git-backed sources", () => {
    expect(isGitBackedSource({ url: "https://github.com/a/b", type: "git" })).toBe(true)
    expect(isGitBackedSource({ url: "https://github.com/a/b" })).toBe(true)
    expect(isGitBackedSource({ type: "upload" })).toBe(false)
    expect(isGitBackedSource({ type: "git" })).toBe(false)
  })

  it("marks missing/error/old syncs stale", () => {
    const now = Date.parse("2026-08-09T16:10:00.000Z")
    const maxAge = 5 * 60_000
    expect(
      isSourceSyncStale(
        { sourceID: "s1", url: "https://x", lastSyncedAt: "" },
        now,
        maxAge,
      ),
    ).toBe(true)
    expect(
      isSourceSyncStale(
        {
          sourceID: "s1",
          url: "https://x",
          lastSyncedAt: "2026-08-09T16:00:00.000Z",
          lastSyncStatus: "error",
        },
        now,
        maxAge,
      ),
    ).toBe(true)
    expect(
      isSourceSyncStale(
        {
          sourceID: "s1",
          url: "https://x",
          lastSyncedAt: "2026-08-09T16:00:00.000Z",
          lastSyncStatus: "ok",
        },
        now,
        maxAge,
      ),
    ).toBe(true)
    expect(
      isSourceSyncStale(
        {
          sourceID: "s1",
          url: "https://x",
          lastSyncedAt: "2026-08-09T16:08:00.000Z",
          lastSyncStatus: "ok",
        },
        now,
        maxAge,
      ),
    ).toBe(false)
  })

  it("reads source id", () => {
    expect(sourceIdOf({ sourceID: "a", id: "b" })).toBe("a")
    expect(sourceIdOf({ id: "b" })).toBe("b")
  })
})
