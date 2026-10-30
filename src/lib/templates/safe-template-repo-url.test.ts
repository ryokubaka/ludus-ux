import net from "net"
import type { AddressInfo } from "net"
import { Readable } from "stream"
import { describe, expect, it, vi } from "vitest"
import {
  assertSafeTemplateRepoUrl,
  pinnedRepoRequest,
  readCappedBody,
  safeRepoFetch,
} from "@/lib/templates/safe-template-repo-url"

/** Accepts TCP and never answers the TLS handshake, like a stalled repo host. */
async function stallingServer(): Promise<{ port: number; close: () => Promise<void> }> {
  const sockets = new Set<net.Socket>()
  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy()
        server.close(() => resolve())
      }),
  }
}

describe("pinnedRepoRequest", () => {
  it("gives up on a host that never answers", async () => {
    const stall = await stallingServer()
    try {
      const target = new URL(`https://repo.example:${stall.port}/api/v4/projects/x/repository/tree`)
      await expect(
        pinnedRepoRequest(target, "127.0.0.1", undefined, { timeoutMs: 200, maxBytes: 1024 }),
      ).rejects.toThrow(/timed out/)
    } finally {
      await stall.close()
    }
  })

  it("stops when the caller aborts, and refuses an already aborted signal", async () => {
    const stall = await stallingServer()
    try {
      const target = new URL(`https://repo.example:${stall.port}/x`)
      const controller = new AbortController()
      const pending = pinnedRepoRequest(target, "127.0.0.1", { signal: controller.signal })
      setTimeout(() => controller.abort(), 50)
      await expect(pending).rejects.toThrow(/abort/i)
      await expect(pinnedRepoRequest(target, "127.0.0.1", { signal: controller.signal })).rejects.toThrow(/abort/i)
    } finally {
      await stall.close()
    }
  })
})

describe("readCappedBody", () => {
  it("returns a small body and rejects one over the cap", async () => {
    await expect(readCappedBody(Readable.from([Buffer.from("abc"), Buffer.from("def")]), 10)).resolves.toEqual(
      Buffer.from("abcdef"),
    )
    await expect(readCappedBody(Readable.from([Buffer.alloc(8), Buffer.alloc(8)]), 10)).rejects.toThrow(
      /larger than 10 bytes/,
    )
  })
})

describe("assertSafeTemplateRepoUrl", () => {
  it("accepts public gitlab api base", () => {
    const r = assertSafeTemplateRepoUrl("https://gitlab.com/api/v4/projects/foo%2Fbar")
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.apiBase).toContain("gitlab.com")
  })

  it("rejects http", () => {
    const r = assertSafeTemplateRepoUrl("http://gitlab.com/api/v4/projects/x")
    expect(r.ok).toBe(false)
  })

  it("rejects private ipv4", () => {
    expect(assertSafeTemplateRepoUrl("https://192.168.1.1/api/v4/projects/x").ok).toBe(false)
    expect(assertSafeTemplateRepoUrl("https://10.0.0.1/foo").ok).toBe(false)
    expect(assertSafeTemplateRepoUrl("https://127.0.0.1/foo").ok).toBe(false)
  })

  it("rejects localhost hostname", () => {
    expect(assertSafeTemplateRepoUrl("https://localhost/api/v4/projects/x").ok).toBe(false)
  })
})

describe("safeRepoFetch", () => {
  it("rejects a hostname that resolves only to loopback", async () => {
    await expect(safeRepoFetch("https://evil.example/repo", undefined, {
      lookup: async () => [{ address: "127.0.0.1" }],
      request: vi.fn(),
    })).rejects.toThrow(/private or reserved/i)
  })

  it("does not follow a redirect to a private address", async () => {
    const request = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "https://rebind.example/secret" },
    }))
    const lookup = vi.fn(async (hostname: string) => {
      if (hostname === "evil.example") return [{ address: "203.0.113.5" }]
      return [{ address: "10.1.1.1" }]
    })
    await expect(safeRepoFetch("https://evil.example/repo", undefined, { lookup, request })).rejects.toThrow(/private or reserved/i)
    expect(request).toHaveBeenCalledTimes(1)
  })
})
