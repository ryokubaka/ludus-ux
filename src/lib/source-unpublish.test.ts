import { afterEach, describe, expect, it, vi } from "vitest"

const sshExec = vi.hoisted(() => vi.fn())
const ludusRequest = vi.hoisted(() => vi.fn())
const listSourceTemplates = vi.hoisted(() => vi.fn())
const listSourceRoles = vi.hoisted(() => vi.fn())
const listSourceCollections = vi.hoisted(() => vi.fn())

vi.mock("@/lib/goad-ssh", () => ({ sshExec }))
vi.mock("@/lib/ludus-client", () => ({ ludusRequest }))
vi.mock("@/lib/ludus-source-client", () => ({
  listSourceTemplates,
  listSourceRoles,
  listSourceCollections,
}))
vi.mock("@/lib/settings-store", () => ({
  getSettings: () => ({ ludusInstallPath: "/opt/ludus" }),
}))

import { removeSourceInstalledItems } from "./source-unpublish"
import { buildLudusTemplateDeleteCmd, buildLudusTemplateRmCliCmd } from "./template-packer-paths"

const templateName = "debian-13-x64-server-template"

function stubCatalog() {
  ludusRequest.mockImplementation(async (path: string) => {
    if (path === "/blueprints") return { data: [] }
    if (path.startsWith("/template/")) return { data: { result: "included template" } }
    return { data: null }
  })
  listSourceTemplates.mockResolvedValue([{ name: templateName }])
  listSourceRoles.mockResolvedValue([])
  listSourceCollections.mockResolvedValue([])
}

describe("removeSourceInstalledItems", () => {
  afterEach(() => {
    sshExec.mockReset()
    ludusRequest.mockReset()
    listSourceTemplates.mockReset()
    listSourceRoles.mockReset()
    listSourceCollections.mockReset()
  })

  it("purges install trees after the CLI remove when that purge exits 0", async () => {
    stubCatalog()
    sshExec.mockResolvedValue({ stdout: "", stderr: "", code: 0 })

    const warnings = await removeSourceInstalledItems("key", "src-1")

    expect(warnings).toEqual([])
    expect(sshExec).toHaveBeenNthCalledWith(1, buildLudusTemplateRmCliCmd(templateName, "key"))
    expect(sshExec).toHaveBeenNthCalledWith(
      2,
      buildLudusTemplateDeleteCmd("/opt/ludus", templateName),
    )
  })

  it("warns when template-purge exits non-zero and still returns", async () => {
    stubCatalog()
    sshExec.mockImplementation(async (cmd: readonly string[]) => {
      if (cmd[0] === "ludus-template-rm") return { stdout: "", stderr: "", code: 1 }
      return { stdout: "", stderr: "still present: /opt/ludus/packer/debian13", code: 1 }
    })

    const warnings = await removeSourceInstalledItems("key", "src-1")

    expect(sshExec).toHaveBeenNthCalledWith(
      2,
      buildLudusTemplateDeleteCmd("/opt/ludus", templateName),
    )
    expect(warnings).toEqual([
      `Template ${templateName}: install directory is still on the Ludus host`,
    ])
  })

  it("still purges and warns when the CLI remove rejects", async () => {
    stubCatalog()
    sshExec.mockImplementation(async (cmd: readonly string[]) => {
      if (cmd[0] === "ludus-template-rm") throw new Error("ssh down")
      return { stdout: "", stderr: "", code: 1 }
    })

    const warnings = await removeSourceInstalledItems("key", "src-1")

    expect(sshExec).toHaveBeenCalledTimes(2)
    expect(warnings).toEqual([
      `Template ${templateName}: install directory is still on the Ludus host`,
    ])
  })
})
