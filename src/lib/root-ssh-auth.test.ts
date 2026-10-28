import { constants, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("./settings-store", () => ({
  getSettings: () => ({ proxmoxSshKeyPath: "" }),
}))

import { CONTAINER_KEY_COPY_DIR, getPrivateKeySearchPathsFor, probeSshKeyMount } from "./root-ssh-auth"

describe("getPrivateKeySearchPathsFor", () => {
  const previous = { p: process.env.PROXMOX_SSH_KEY_PATH, g: process.env.GOAD_SSH_KEY_PATH }

  afterEach(() => {
    if (previous.p === undefined) delete process.env.PROXMOX_SSH_KEY_PATH
    else process.env.PROXMOX_SSH_KEY_PATH = previous.p
    if (previous.g === undefined) delete process.env.GOAD_SSH_KEY_PATH
    else process.env.GOAD_SSH_KEY_PATH = previous.g
  })

  it("tries the entrypoint's readable copy before each mounted key", () => {
    process.env.PROXMOX_SSH_KEY_PATH = "/app/ssh/id_rsa"
    delete process.env.GOAD_SSH_KEY_PATH
    const paths = getPrivateKeySearchPathsFor({ proxmoxSshKeyPath: "/keys/custom" })
    expect(paths.slice(0, 3)).toEqual(["/keys/custom", `${CONTAINER_KEY_COPY_DIR}/id_rsa`, "/app/ssh/id_rsa"])
    expect(paths.indexOf(`${CONTAINER_KEY_COPY_DIR}/id_ed25519`)).toBe(paths.indexOf("/app/ssh/id_ed25519") - 1)
  })
})

describe("probeSshKeyMount", () => {
  it("reads a regular key and a symlink the same way the probe did", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lux-key-"))
    const key = path.join(dir, "id_ed25519")
    const empty = path.join(dir, "empty")
    try {
      writeFileSync(key, "openssh-test-key\n")
      writeFileSync(empty, "")
      process.env.PROXMOX_SSH_KEY_PATH = key
      delete process.env.GOAD_SSH_KEY_PATH
      const regular = probeSshKeyMount({ proxmoxSshKeyPath: "" }).candidates.find((c) => c.path === key)
      expect(regular).toMatchObject({ exists: true, isFile: true, isSymlink: false, readable: true })

      process.env.PROXMOX_SSH_KEY_PATH = empty
      const blank = probeSshKeyMount({ proxmoxSshKeyPath: "" }).candidates.find((c) => c.path === empty)
      expect(blank).toMatchObject({ exists: true, isFile: true, readable: false, readError: "File is empty" })

      if (constants.O_NOFOLLOW) {
        const link = path.join(dir, "linked")
        symlinkSync(key, link)
        process.env.PROXMOX_SSH_KEY_PATH = link
        const viaLink = probeSshKeyMount({ proxmoxSshKeyPath: "" }).candidates.find((c) => c.path === link)
        expect(viaLink).toMatchObject({ isSymlink: true, isFile: true, readable: true, linkTarget: key })
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
