import { describe, expect, it } from "vitest"
import { formatLuxaiMessageTime } from "@/lib/luxai/message-time"

describe("formatLuxaiMessageTime", () => {
  const now = new Date(2026, 10, 20, 18, 16, 4).getTime()

  it("shows the clock time for a message from today", () => {
    const sent = now - 90_000
    expect(formatLuxaiMessageTime(sent, now)).toBe(
      new Date(sent).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }),
    )
  })

  it("includes the date when the message is from another day", () => {
    const sent = now - 2 * 24 * 60 * 60 * 1000
    expect(formatLuxaiMessageTime(sent, now)).toBe(
      new Date(sent).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      }),
    )
    expect(formatLuxaiMessageTime(sent, now)).not.toBe(formatLuxaiMessageTime(sent, sent))
  })

  it("returns nothing for a missing time", () => {
    expect(formatLuxaiMessageTime(Number.NaN, now)).toBe("")
  })
})
