import { describe, expect, it, beforeEach, afterEach } from "vitest"
import {
  IMPERSONATION_STORAGE_KEY,
  impersonationHeadersFromData,
  readImpersonationHeadersFromSessionStorage,
} from "./impersonation-headers"

describe("impersonation-headers", () => {
  const mem: Record<string, string> = {}

  beforeEach(() => {
    Object.keys(mem).forEach((k) => delete mem[k])
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        sessionStorage: {
          getItem: (k: string) => (k in mem ? mem[k] : null),
          setItem: (k: string, v: string) => {
            mem[k] = v
          },
          removeItem: (k: string) => {
            delete mem[k]
          },
          clear: () => {
            Object.keys(mem).forEach((k) => delete mem[k])
          },
        },
      },
    })
  })

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window")
  })

  it("reads only X-Impersonate-As from sessionStorage (apiKey is not exposed)", () => {
    // Storage may contain legacy {apiKey, username} — only username should be emitted.
    mem[IMPERSONATION_STORAGE_KEY] = JSON.stringify({ apiKey: "k1", username: "u1" })
    expect(readImpersonationHeadersFromSessionStorage()).toEqual({
      "X-Impersonate-As": "u1",
    })
  })

  it("reads only username when stored without apiKey", () => {
    mem[IMPERSONATION_STORAGE_KEY] = JSON.stringify({ username: "u2" })
    expect(readImpersonationHeadersFromSessionStorage()).toEqual({
      "X-Impersonate-As": "u2",
    })
  })

  it("returns empty object when storage is empty", () => {
    expect(readImpersonationHeadersFromSessionStorage()).toEqual({})
  })

  it("builds headers from data object with only X-Impersonate-As", () => {
    expect(impersonationHeadersFromData({ username: "b" })).toEqual({
      "X-Impersonate-As": "b",
    })
    expect(impersonationHeadersFromData(null)).toEqual({})
  })
})
