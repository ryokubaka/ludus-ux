import { spawnSync } from "child_process"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/ansible/ansible-requirements-server", () => ({ fetchInstalledAnsibleServer: vi.fn(async () => []) }))
vi.mock("@/lib/ludus/ludus-cache-revalidate", () => ({ revalidateLudusResource: vi.fn() }))
vi.mock("@/lib/ansible/ansible-home-repair", () => ({ ensureAnsibleHomeLayoutAsRoot: vi.fn(async () => undefined) }))
vi.mock("@/lib/core/runtime-paths", () => ({ resolveLudushoundPath: () => "/opt/LudusHound" }))
vi.mock("@/lib/goad/goad-ssh", () => ({
  sshExec: vi.fn(async () => ({ stdout: "INSTALL_OK\n", stderr: "", code: 0 })),
}))

import { sshExec } from "@/lib/goad/goad-ssh"
import { installLudushoundCollectionFromTarball } from "@/lib/ludushound/ludushound-ansible-requirements"

const key = "alice.ludushound-secret"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("installLudushoundCollectionFromTarball", () => {
  it.each([["no Linux user", undefined], ["sudo as the Linux user", "alice"]])(
    "sends the key on stdin with %s",
    async (_label, linuxUser) => {
      const result = await installLudushoundCollectionFromTarball({ apiKey: key, linuxUser })
      expect(result.ok).toBe(true)
      const [command, , opts] = vi.mocked(sshExec).mock.calls[0] as unknown as [string, unknown, { stdin: string }]
      expect(command).not.toContain(key)
      expect(opts.stdin).toBe(`${key}\n`)
    },
  )

  it.skipIf(process.platform === "win32")("reads the key from stdin into LUDUS_API_KEY", async () => {
    await installLudushoundCollectionFromTarball({ apiKey: key })
    const [command, , opts] = vi.mocked(sshExec).mock.calls[0] as unknown as [string, unknown, { stdin: string }]
    const probe = command
      .replace(/^test -f .*?\} && /, "")
      .replace(/ludus ansible collection add [^&]+/, 'printf "%s" "$LUDUS_API_KEY" ')
    const out = spawnSync("bash", ["-c", probe], { input: opts.stdin, encoding: "utf8" })
    expect(out.stdout.startsWith(key)).toBe(true)
  })
})
