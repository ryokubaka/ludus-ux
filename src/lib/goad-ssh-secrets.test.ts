import type { AddressInfo } from "net"
import { Server, utils } from "ssh2"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const gate = vi.hoisted(() => ({ port: 0 }))

vi.mock("./settings-store", () => ({
  getSettings: () => ({
    sshHost: "127.0.0.1",
    sshPort: gate.port,
    proxmoxSshUser: "root",
    proxmoxSshPassword: "root-pw",
    ludusAnsibleVerbose: false,
  }),
}))
vi.mock("./ssh-host-key", () => ({
  attachSshHostVerifier: (config: unknown) => config,
  explainSshHostKeyError: (message: string) => message,
}))
vi.mock("./runtime-paths", () => ({
  resolveGoadPath: () => "/opt/GOAD",
  resolveLudusInstallPath: () => "/opt/ludus",
  resolveLudushoundPath: () => "/opt/LudusHound",
}))
vi.mock("./ludus-platform-ansible-requirements", () => ({
  ensureLudusPlatformAnsibleRequirements: async () => ({ ok: true }),
}))
vi.mock("./goad-ansible-requirements", () => ({
  ensureGoadAnsibleRequirements: async () => ({ ok: true }),
}))
vi.mock("./ansible-home-repair", () => ({ ensureAnsibleHomeLayoutAsRoot: vi.fn(async () => undefined) }))
vi.mock("./lux-host-sync", () => ({ ensureLuxHostCurrent: vi.fn(async () => ({ ok: true })) }))
vi.mock("./range-deploy-host-patches", () => ({ ensureRangeDeployHostPatches: vi.fn(async () => ({ ok: true })) }))
vi.mock("./ludus-proxmox-deploy-env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ludus-proxmox-deploy-env")>()
  return {
    ...actual,
    readLudusProxmoxDeployEnv: async () => ({
      PROXMOX_URL: "https://127.0.0.1:8006",
      PROXMOX_USERNAME: "root@pam",
      PROXMOX_TOKEN: "ludus-token",
      PROXMOX_SECRET: "pve-token-secret",
      PROXMOX_NODE: "pve",
      PROXMOX_HOSTNAME: "127.0.0.1",
    }),
  }
})

import { streamGoadCommand } from "./goad-ssh"

type Exec = { command: string; pty: boolean; stdin: string }
const execs: Exec[] = []
const ENV_FILE = "/tmp/lux-goad-env.TESTFILE1"

let server: Server
const clients = new Set<{ end(): void }>()

beforeAll(async () => {
  const host = utils.generateKeyPairSync("ed25519")
  server = new Server({ hostKeys: [host.private] }, (client) => {
    clients.add(client)
    client.on("close", () => clients.delete(client))
    client.on("authentication", (ctx) => ctx.accept())
    client.on("error", () => {})
    client.on("ready", () => {
      client.on("session", (acceptSession) => {
        const session = acceptSession()
        let pty = false
        session.on("pty", (accept) => {
          pty = true
          accept?.()
        })
        session.on("exec", (accept, _reject, info) => {
          const stream = accept()
          const record: Exec = { command: info.command, pty, stdin: "" }
          execs.push(record)
          stream.on("data", (data: Buffer) => {
            record.stdin += data.toString()
          })
          const envStep = !pty && /\bbash -s$/.test(info.command)
          const finish = () => {
            if (envStep) stream.write(`${ENV_FILE}\n`)
            stream.exit(0)
            stream.end()
          }
          // Only the env step sends stdin and EOF; every other exec ends at once.
          if (envStep) stream.on("end", finish)
          else finish()
        })
      })
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  gate.port = (server.address() as AddressInfo).port
})

afterAll(async () => {
  for (const client of clients) client.end()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

beforeEach(() => {
  execs.length = 0
})

function runGoad(
  goadArgs: string,
  opts: { creds?: { username: string; password: string }; impersonateAs?: { username: string; apiKey: string } },
): Promise<{ code: number; lines: string[] }> {
  return new Promise((resolve, reject) => {
    const lines: string[] = []
    void streamGoadCommand(
      goadArgs,
      "alice-ludus-secret",
      (line) => lines.push(line),
      (code) => resolve({ code, lines }),
      reject,
      opts.creds,
      opts.impersonateAs,
      undefined,
      "alice-range",
      undefined,
      undefined,
      undefined,
      Boolean(opts.impersonateAs),
    )
  })
}

function assertSecretsOffArgv(secret: string) {
  const pty = execs.filter((e) => e.pty)
  expect(pty.length).toBeGreaterThan(0)
  for (const exec of execs) {
    expect(exec.command).not.toContain(secret)
    expect(exec.command).not.toContain("pve-token-secret")
  }
  const envStep = execs.find((e) => !e.pty && /\bbash -s$/.test(e.command))
  expect(envStep?.stdin).toContain(`export LUDUS_API_KEY='${secret}'`)
  expect(envStep?.stdin).toContain("export PROXMOX_SECRET='pve-token-secret'")
  expect(envStep?.stdin).toMatch(/umask 077/)
  // Under `sudo ... bash -c '...'` the quotes around the path are escaped.
  for (const exec of pty) expect(exec.command.split(ENV_FILE).length - 1).toBe(2)
}

describe("streamGoadCommand keeps secrets out of remote argv", () => {
  it("REPL run as the user's own SSH login", async () => {
    const result = await runGoad(`--repl "use abc123-goad-mini-ludus;status"`, {
      creds: { username: "alice", password: "alice-pw" },
    })
    expect(result.code).toBe(0)
    assertSecretsOffArgv("alice-ludus-secret")
  })

  it("non-REPL run", async () => {
    const result = await runGoad("-t check -l GOAD-Mini -p ludus", {
      creds: { username: "alice", password: "alice-pw" },
    })
    expect(result.code).toBe(0)
    assertSecretsOffArgv("alice-ludus-secret")
  })

  it("admin impersonation through root writes the env file as the target user", async () => {
    const result = await runGoad(`--repl "use abc123-goad-mini-ludus;status"`, {
      impersonateAs: { username: "bob", apiKey: "bob-ludus-secret" },
    })
    expect(result.code).toBe(0)
    assertSecretsOffArgv("bob-ludus-secret")
    expect(execs.some((e) => e.command === "sudo -H -u 'bob' bash -s")).toBe(true)
  })
})
