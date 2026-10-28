import type { AddressInfo } from "net"
import { Server, utils } from "ssh2"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("./ssh-host-key", () => ({
  attachSshHostVerifier: (config: unknown) => config,
  explainSshHostKeyError: (message: string) => message,
}))

type Exec = { command: string; stdin: string }
const execs: Exec[] = []
let server: Server

beforeAll(async () => {
  const host = utils.generateKeyPairSync("ed25519")
  server = new Server({ hostKeys: [host.private] }, (client) => {
    client.on("authentication", (ctx) => ctx.accept())
    client.on("error", () => {})
    client.on("ready", () => {
      client.on("session", (acceptSession) => {
        acceptSession().on("exec", (accept, _reject, info) => {
          const stream = accept()
          const record: Exec = { command: info.command, stdin: "" }
          execs.push(record)
          stream.on("data", (data: Buffer) => {
            record.stdin += data.toString()
          })
          stream.on("end", () => {
            stream.exit(0)
            stream.end()
          })
        })
      })
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  process.env.LUDUS_SSH_HOST = "127.0.0.1"
  process.env.LUDUS_SSH_PORT = String((server.address() as AddressInfo).port)
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe("saveApiKeyToBashrc", () => {
  it("appends the key from stdin, not from the command string", async () => {
    vi.resetModules()
    const { saveApiKeyToBashrc } = await import("./auth-ssh")
    const key = "alice.bashrc-secret-key"
    const result = await saveApiKeyToBashrc("alice", "pw", key)
    expect(result.success).toBe(true)
    expect(execs).toHaveLength(1)
    expect(execs[0].command).not.toContain(key)
    expect(execs[0].command).not.toContain(Buffer.from(`export LUDUS_API_KEY=${key}`).toString("base64").slice(0, 16))
    expect(execs[0].command).toMatch(/cat >> ~\/\.bashrc$/)
    expect(execs[0].stdin).toBe(`export LUDUS_API_KEY=${key}\nexport LUDUS_VERSION=2\n`)
  })
})
