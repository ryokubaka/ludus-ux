import { afterEach, describe, expect, it, vi } from "vitest"
import { proxmoxCreateSpiceProxy, proxmoxCreateVncProxy } from "./proxmox-http"

const auth = { cookie: "cookie", csrf: "csrf" }

function stubFetch(data: unknown) {
  const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ data }), { status: 200 }))
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

function sentBody(fetchMock: ReturnType<typeof stubFetch>): string {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
  return String(init?.body ?? "")
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("proxmoxCreateSpiceProxy", () => {
  it("sends the bare host as proxy", async () => {
    const fetchMock = stubFetch({ password: "pw", host: "pvespiceproxy:abc", proxy: "http://10.0.20.40:3128" })
    const ticket = await proxmoxCreateSpiceProxy("10.0.20.40", auth, "minipve", "111")
    expect(sentBody(fetchMock)).toBe("proxy=10.0.20.40")
    expect(ticket.proxy).toBe("http://10.0.20.40:3128")
  })
})

describe("proxmoxCreateVncProxy", () => {
  it("asks for a websocket ticket by default", async () => {
    const fetchMock = stubFetch({ ticket: "PVEVNC:x", port: 5900 })
    await proxmoxCreateVncProxy("10.0.20.40", auth, "minipve", "111")
    expect(sentBody(fetchMock)).toBe("websocket=1")
  })

  it("returns the VNC protocol password for a plain proxy", async () => {
    const fetchMock = stubFetch({ ticket: "abcdefgh:PVEVNC:x", port: "5900", password: "abcdefgh" })
    const vnc = await proxmoxCreateVncProxy("10.0.20.40", auth, "minipve", "111", { websocket: false })
    expect(sentBody(fetchMock)).toBe("")
    expect(vnc).toMatchObject({ port: "5900", password: "abcdefgh" })
  })
})
