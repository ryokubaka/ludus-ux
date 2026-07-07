import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/ludus-client", () => ({
  ludusGet: vi.fn(),
  ludusPost: vi.fn(),
}))

vi.mock("@/lib/ludus-cache-revalidate", () => ({
  revalidateLudusResource: vi.fn(),
}))

import { ludusGet, ludusPost } from "@/lib/ludus-client"
import { revalidateLudusResource } from "@/lib/ludus-cache-revalidate"
import { installMissingAnsibleRequirementsServer } from "./ansible-requirements-server"

describe("installMissingAnsibleRequirementsServer", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("POSTs to Ludus ansible endpoints and treats 409 as already installed", async () => {
    vi.mocked(ludusPost)
      .mockResolvedValueOnce({ status: 409, error: "Collection already installed" })
      .mockResolvedValueOnce({ status: 201, data: { result: "ok" } })

    const result = await installMissingAnsibleRequirementsServer("ROOT.key", [
      { kind: "collection", name: "ansible.windows", version: "2.5.0" },
      { kind: "role", name: "geerlingguy.mysql" },
    ])

    expect(result.ok).toBe(true)
    expect(result.installed).toEqual(["ansible.windows", "geerlingguy.mysql"])
    expect(ludusPost).toHaveBeenCalledWith(
      "/ansible/collection",
      expect.objectContaining({ collection: "ansible.windows", action: "install", version: "2.5.0" }),
      expect.objectContaining({ apiKey: "ROOT.key" }),
    )
    expect(ludusPost).toHaveBeenCalledWith(
      "/ansible/role",
      expect.objectContaining({ role: "geerlingguy.mysql", action: "install" }),
      expect.anything(),
    )
    expect(revalidateLudusResource).toHaveBeenCalledWith("ansible")
  })

  it("returns failed entries when Ludus rejects install", async () => {
    vi.mocked(ludusPost).mockResolvedValue({ status: 500, error: "Unable to install" })

    const result = await installMissingAnsibleRequirementsServer("ROOT.key", [
      { kind: "collection", name: "ansible.windows" },
    ])

    expect(result.ok).toBe(false)
    expect(result.failed).toHaveLength(1)
    expect(revalidateLudusResource).not.toHaveBeenCalled()
  })

  it("passes force:true to Ludus collection install", async () => {
    vi.mocked(ludusPost).mockResolvedValue({ status: 201, data: { result: "ok" } })

    await installMissingAnsibleRequirementsServer(
      "ROOT.key",
      [{ kind: "collection", name: "ansible.windows", version: "2.5.0" }],
      { force: true },
    )

    expect(ludusPost).toHaveBeenCalledWith(
      "/ansible/collection",
      expect.objectContaining({ collection: "ansible.windows", force: true, version: "2.5.0" }),
      expect.anything(),
    )
  })
})

describe("fetchInstalledAnsibleServer", () => {
  it("reads GET /ansible", async () => {
    vi.mocked(ludusGet).mockResolvedValue({
      status: 200,
      data: [{ name: "ansible.windows", type: "collection", version: "2.5.0" }],
    })

    const { fetchInstalledAnsibleServer } = await import("./ansible-requirements-server")
    const items = await fetchInstalledAnsibleServer("ROOT.key")

    expect(items).toHaveLength(1)
    expect(ludusGet).toHaveBeenCalledWith("/ansible", { apiKey: "ROOT.key" })
  })
})
