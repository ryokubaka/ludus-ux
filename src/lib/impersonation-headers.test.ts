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

  it("reads headers from sessionStorage", () => {
    mem[IMPERSONATION_STORAGE_KEY] = JSON.stringify({ apiKey: "k1", username: "u1" })
    expect(readImpersonationHeadersFromSessionStorage()).toEqual({
      "X-Impersonate-Apikey": "k1",
      "X-Impersonate-As": "u1",
    })
  })

  it("builds headers from data object", () => {
    expect(impersonationHeadersFromData({ apiKey: "a", username: "b" })).toEqual({
      "X-Impersonate-Apikey": "a",
      "X-Impersonate-As": "b",
    })
    expect(impersonationHeadersFromData(null)).toEqual({})
  })
})
