import { execFileSync } from "child_process"
import { createHash } from "crypto"
import { mkdtempSync, rmSync, writeFileSync } from "fs"
import type { AddressInfo } from "net"
import os from "os"
import path from "path"
import { Client, Server, utils } from "ssh2"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { resetDbForTests } from "./db"
import {
  attachSshHostVerifier,
  evaluateSshHostKey,
  explainSshHostKeyError,
  forgetSshHostKey,
  parseHostKeyPin,
  verifySshHostKey,
} from "./ssh-host-key"

const keyA = Buffer.from("host-key-a")
const keyB = Buffer.from("host-key-b")

function memoryStore() {
  const saved = new Map<string, string>()
  return {
    saved,
    get(host: string, port: number) {
      return saved.get(`${host}:${port}`) ?? null
    },
    put(host: string, port: number, fingerprint: string) {
      saved.set(`${host}:${port}`, fingerprint)
    },
    remove(host: string, port: number) {
      return saved.delete(`${host}:${port}`)
    },
  }
}

async function withPin<T>(pin: string | undefined, run: () => T | Promise<T>): Promise<T> {
  const previous = process.env.LUX_SSH_HOST_KEY
  if (pin === undefined) delete process.env.LUX_SSH_HOST_KEY
  else process.env.LUX_SSH_HOST_KEY = pin
  try {
    return await run()
  } finally {
    if (previous === undefined) delete process.env.LUX_SSH_HOST_KEY
    else process.env.LUX_SSH_HOST_KEY = previous
  }
}

describe("evaluateSshHostKey", () => {
  it("remembers the first key and rejects a different key later", () => {
    const first = evaluateSshHostKey(keyA, null, undefined)
    expect(first.accept).toBe(true)
    const again = evaluateSshHostKey(keyA, first.fingerprint, undefined)
    expect(again.accept).toBe(true)
    const changed = evaluateSshHostKey(keyB, first.fingerprint, undefined)
    expect(changed.accept).toBe(false)
  })

  it("rejects a key that does not match LUX_SSH_HOST_KEY", () => {
    const pinned = evaluateSshHostKey(keyA, null, undefined).fingerprint
    expect(evaluateSshHostKey(keyB, null, pinned).accept).toBe(false)
    expect(evaluateSshHostKey(keyA, "something-else", pinned).accept).toBe(true)
  })

  it("matches a stored fingerprint with or without base64 padding", () => {
    const stored = evaluateSshHostKey(keyA, null, undefined).fingerprint
    expect(stored.endsWith("=")).toBe(true)
    expect(evaluateSshHostKey(keyA, stored.replace(/=+$/, ""), undefined).accept).toBe(true)
  })
})

describe("parseHostKeyPin", () => {
  it("reads fingerprints, key lines, and known_hosts lines", () => {
    const { public: line } = utils.generateKeyPairSync("ed25519", { comment: "ops@ludus" })
    expect(parseHostKeyPin("SHA256:abc=").kind).toBe("fingerprint")
    expect(parseHostKeyPin(line).kind).toBe("key")
    expect(parseHostKeyPin(`ludus.example,10.0.0.5 ${line.split(" ").slice(0, 2).join(" ")}`).kind).toBe("key")
    expect(parseHostKeyPin("ssh-ed25519 AAAAB3NzaC1yc2EAAAADAQABAAABAQ").kind).toBe("invalid")
    expect(parseHostKeyPin("not a key").kind).toBe("invalid")
  })
})

describe("verifySshHostKey", () => {
  it("stores the first fingerprint and rejects the next key", async () => {
    const store = memoryStore()
    await withPin(undefined, () => {
      expect(verifySshHostKey("ludus.example", 22, keyA, store)).toBe(true)
      expect(verifySshHostKey("ludus.example", 22, keyB, store)).toBe(false)
    })
    expect(store.saved.size).toBe(1)
  })

  it("explains a rejected key, and forgetting it lets the next key pin", async () => {
    const store = memoryStore()
    await withPin(undefined, () => {
      verifySshHostKey("ludus.example", 2222, keyA, store)
      expect(verifySshHostKey("ludus.example", 2222, keyB, store)).toBe(false)
      const message = explainSshHostKeyError("Host denied (verification failed)", "ludus.example", 2222)
      expect(message).toContain("ludus.example:2222")
      expect(message).toContain(evaluateSshHostKey(keyB, null, undefined).fingerprint)
      expect(forgetSshHostKey("ludus.example", 2222, store)).toBe(true)
      expect(verifySshHostKey("ludus.example", 2222, keyB, store)).toBe(true)
    })
    expect(explainSshHostKeyError("connect ECONNREFUSED", "ludus.example", 2222)).toBe("connect ECONNREFUSED")
  })
})

describe("LUX_SSH_HOST_KEY against a real ssh2 server", () => {
  const host = utils.generateKeyPairSync("ed25519", { comment: "root@ludus" })
  const other = utils.generateKeyPairSync("ed25519", { comment: "root@other" })
  const blob = Buffer.from(host.public.split(" ")[1], "base64")
  const keygenStyle = `SHA256:${createHash("sha256").update(blob).digest("base64").replace(/=+$/, "")}`
  let server: Server
  let port = 0
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "lux-hostkey-"))
  const prevData = process.env.DATA_DIR

  beforeAll(async () => {
    // A pin never writes the TOFU table, but keep any write off the real data dir.
    resetDbForTests()
    process.env.DATA_DIR = dataDir
    server = new Server({ hostKeys: [host.private] }, (client) => {
      client.on("authentication", (ctx) => ctx.accept())
      client.on("ready", () => client.end())
      client.on("error", () => {})
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    port = (server.address() as AddressInfo).port
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    resetDbForTests()
    if (prevData === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = prevData
    rmSync(dataDir, { recursive: true, force: true })
  })

  function connectWithPin(pin: string): Promise<boolean> {
    return withPin(pin, () =>
      new Promise<boolean>((resolve) => {
        const conn = new Client()
        conn.on("ready", () => {
          conn.end()
          resolve(true)
        })
        conn.on("error", () => resolve(false))
        conn.connect(attachSshHostVerifier({ host: "127.0.0.1", port, username: "lux", password: "x", readyTimeout: 5000 }))
      }),
    )
  }

  it.each([
    ["ssh-keygen fingerprint without padding", () => keygenStyle],
    ["fingerprint with padding", () => `${keygenStyle}=`],
    ["public key line", () => host.public],
    ["known_hosts line", () => `[127.0.0.1]:2222 ${host.public.split(" ").slice(0, 2).join(" ")}`],
  ])("connects with the %s", async (_label, pin) => {
    expect(await connectWithPin(pin())).toBe(true)
  })

  it.each([
    ["another host's key line", () => other.public],
    ["a garbage pin", () => "definitely-not-a-key"],
  ])("refuses %s", async (_label, pin) => {
    expect(await connectWithPin(pin())).toBe(false)
  })

  it("accepts exactly what ssh-keygen -lf prints for the host key", async () => {
    let printed = ""
    const dir = mkdtempSync(path.join(os.tmpdir(), "lux-keygen-"))
    try {
      const file = path.join(dir, "host.pub")
      writeFileSync(file, `${host.public}\n`)
      printed = execFileSync("ssh-keygen", ["-lf", file], { encoding: "utf8" }).split(/\s+/)[1] ?? ""
    } catch {
      return
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    expect(printed).toBe(keygenStyle)
    expect(await connectWithPin(printed)).toBe(true)
  })
})
