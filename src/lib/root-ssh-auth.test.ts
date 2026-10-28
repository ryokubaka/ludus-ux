import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("./settings-store", () => ({
  getSettings: () => ({ proxmoxSshKeyPath: "" }),
}))

import { CONTAINER_KEY_COPY_DIR, getPrivateKeySearchPathsFor } from "./root-ssh-auth"

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
