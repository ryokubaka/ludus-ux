import { createRequire } from "node:module"
import { spawn, spawnSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import http from "node:http"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"

const require = createRequire(import.meta.url)
const { Server } = require("ssh2")
const { chromium } = require("playwright")

const ROOT = "/home/melchior/.no-mistakes/worktrees/a9d6eeb594f3/01M3YXJB2E15S8CHBWPKZY73YN"
const LIVE = path.join(ROOT, ".lux-live")
const EVIDENCE = process.env.LUX_EVIDENCE || "/home/melchior/.no-mistakes/evidence/01M3YXJB2E15S8CHBWPKZY73YN"
const PROD_UI = process.env.LUX_PROD_UI === "1"
const APP_SECRET = "0123456789abcdef0123456789abcdef"
const UPDATE_KEY = crypto.randomBytes(32).toString("hex")
const DATA_DIR = path.join(LIVE, "data")
const REPO = "/tmp/lux-live-repo-01M3YXJB"
const RECORD = path.join(LIVE, "systemd-run-args.txt")

const users = {
  luxadmin: {
    password: "adminpass",
    bashrc: "export LUDUS_API_KEY=adminkey1234567890\n",
    apiKey: "adminkey1234567890",
    isAdmin: true,
    userID: "luxadmin",
    name: "luxadmin",
    proxmoxUsername: "luxadmin",
  },
  testuser: {
    password: "userpass",
    bashrc: "export LUDUS_API_KEY=userkey1234567890ab\n",
    apiKey: "userkey1234567890ab",
    isAdmin: false,
    userID: "testuser",
    name: "testuser",
    proxmoxUsername: "alice",
  },
  luxuser: {
    password: "luxpass",
    bashrc: "export LUDUS_API_KEY=hostkey1234567890ab\n",
    apiKey: "hostkey1234567890ab",
    isAdmin: false,
    userID: "luxuser",
    name: "luxuser",
    proxmoxUsername: "luxuser",
  },
}

const scenarios = []
const children = []
let seq = 0

function scenario(name, result, live, evidence, reason) {
  scenarios.push({ name, result, live, evidence, reason })
  console.log(`[${result}] ${name}`)
}

function hmacBody(body, key = UPDATE_KEY) {
  const mac = crypto.createHmac("sha256", key).update(body).digest("hex")
  return `${mac}\n${body}`
}

async function reclaimSandboxTree() {
  if (!fs.existsSync(path.join(LIVE, "opt"))) return
  const result = await runInNs(`chown -R 0:0 ${JSON.stringify(path.join(LIVE, "opt"))} ${JSON.stringify(REPO)}`)
  if (result.code !== 0) throw new Error(`reclaim failed ${result.code} ${result.err}`)
}

function writeTree() {
  const etc = path.join(LIVE, "etc")
  fs.mkdirSync(etc, { recursive: true })
  fs.writeFileSync(
    path.join(etc, "passwd"),
    [
      "root:x:0:0:root:/root:/bin/bash",
      "luxuser:x:1000:1000::/home/luxuser:/bin/bash",
      "alice:x:2000:2000::/home/alice:/bin/bash",
      "testuser:x:2001:2001::/home/testuser:/bin/bash",
      "luxadmin:x:2002:2002::/home/luxadmin:/bin/bash",
    ].join("\n") + "\n",
  )
  fs.writeFileSync(
    path.join(etc, "group"),
    ["root:x:0:", "luxuser:x:1000:", "alice:x:2000:", "testuser:x:2001:", "luxadmin:x:2002:"].join("\n") + "\n",
  )
  fs.writeFileSync(path.join(etc, "nsswitch.conf"), "passwd: files\ngroup: files\nshadow: files\nhosts: files\n")
  fs.writeFileSync(path.join(etc, "profile"), "# sandbox\n")
  fs.writeFileSync(path.join(etc, "bash.bashrc"), "# sandbox\n")
  fs.writeFileSync(path.join(etc, "hosts"), "127.0.0.1 localhost\n")
  fs.writeFileSync(path.join(etc, "lux-host.update-key"), UPDATE_KEY + "\n", { mode: 0o600 })
  for (const name of ["sudo", "systemd-run", "docker"]) {
    fs.chmodSync(path.join(LIVE, "bin", name), 0o755)
  }
  fs.chmodSync(path.join(LIVE, "ns.sh"), 0o755)

  const opt = path.join(LIVE, "opt")
  fs.mkdirSync(path.join(opt, "ludus"), { recursive: true })
  fs.rmSync(path.join(opt, "ludus/.sticky-ro"), { force: true })
  const packer = path.join(opt, "ludus/packer/debian13")
  const userPacker = path.join(opt, "ludus/users/alice/packer/debian-13-x64-server-template")
  const source = path.join(opt, "ludus/sources/src-1/templates/debian13")
  const goadWs = path.join(opt, "goad/workspace/inst1")
  const lab = path.join(opt, "goad/ad/mini/providers/ludus")
  const ext = path.join(opt, "goad/extensions/fleet/providers/ludus")
  const tpl = path.join(opt, "goad/template/provider/ludus")
  for (const dir of [packer, userPacker, source, goadWs, lab, ext, tpl, path.join(opt, "goad/ad/mini/data")]) {
    fs.mkdirSync(dir, { recursive: true })
  }
  const pkr = 'vm_name = "debian-13-x64-server-template"\n'
  fs.writeFileSync(path.join(packer, "debian.pkr.hcl"), pkr)
  fs.writeFileSync(path.join(userPacker, "pin.txt"), "installed\n")
  fs.writeFileSync(path.join(source, "debian.pkr.hcl"), pkr)
  fs.writeFileSync(path.join(source, "KEEP"), "source checkout\n")
  fs.writeFileSync(path.join(goadWs, "instance.json"), "{}\n")
  fs.writeFileSync(path.join(opt, "goad/ad/mini/README.md"), "Disposable lab for firewall rule checks.\n")
  fs.writeFileSync(
    path.join(opt, "goad/ad/mini/data/config.json"),
    JSON.stringify({ lab: { hosts: { DC: { domain: "lab.local" } } } }),
  )
  fs.writeFileSync(
    path.join(lab, "config.yml"),
    "ludus:\n  - vm_name: \"{{ range_id }}-DC\"\n    hostname: dc\n    vlan: 10\n",
  )
  fs.writeFileSync(
    path.join(ext, "config.yml"),
    [
      "network:",
      "  rules:",
      "    - name: Allow targets to SO Fleet",
      "      vlan_src: 10",
      "      vlan_dst: 20",
      "      protocol: tcp",
      '      ports: "8220"',
      "      action: ACCEPT",
      "    - name: allow-443",
      "      vlan_src: 10",
      "      vlan_dst: 10",
      "      protocol: tcp",
      '      ports: "443"',
      "      action: ACCEPT",
      "",
    ].join("\n"),
  )
  fs.writeFileSync(path.join(opt, "goad/extensions/fleet/extension.json"), JSON.stringify({
    description: "Fleet sensors",
    compatibility: ["*"],
    machines: [],
  }))
  fs.writeFileSync(path.join(tpl, "config.yml"), "{{ lab }}\n{{ extensions }}\n")

  if (!fs.existsSync(path.join(REPO, ".git"))) {
    fs.mkdirSync(path.join(REPO, "scripts"), { recursive: true })
    fs.writeFileSync(path.join(REPO, "docker-compose.yml"), "services: {}\n")
    fs.writeFileSync(path.join(REPO, "scripts/upgrade.sh"), "#!/bin/bash\necho RAN_CHECKOUT\n")
    fs.chmodSync(path.join(REPO, "scripts/upgrade.sh"), 0o755)
    const git = (args) => spawnSync("git", args, { cwd: REPO, stdio: "inherit" })
    git(["init", "-b", "main"])
    git(["config", "user.email", "lux@example.invalid"])
    git(["config", "user.name", "LUX Live"])
    git(["add", "."])
    git(["commit", "-m", "disposable checkout"])
  }
}

function runInNs(command, stdin = "", timeout = 60000) {
  return new Promise((resolve) => {
    const id = ++seq
    const cmdFile = path.join(LIVE, `cmd-${id}.sh`)
    const fifo = path.join(LIVE, `fifo-${id}`)
    fs.writeFileSync(cmdFile, command.endsWith("\n") ? command : command + "\n")
    spawnSync("mkfifo", [fifo])
    const child = spawn("unshare", ["--user", "--mount", "bash", path.join(LIVE, "ns.sh")], {
      env: {
        PATH: process.env.PATH,
        FAKE_ETC: path.join(LIVE, "etc"),
        FAKE_USR_LOCAL: path.join(LIVE, "usr-local"),
        FAKE_OPT: path.join(LIVE, "opt"),
        HOST_BIN: path.join(LIVE, "bin"),
        PY_PATH: path.join(LIVE, "py"),
        LUX_HOST_SCRIPT: path.join(ROOT, "scripts/lux-host/lux-host"),
        REPO,
        RELEASE_FIFO: fifo,
        CMD_FILE: cmdFile,
        LUX_SYSTEMD_RECORD: RECORD,
        SUDO_USER: "luxuser",
      },
      stdio: ["pipe", "pipe", "pipe"],
    })
    let out = ""
    let err = ""
    let ready = false
    const timer = setTimeout(() => {
      child.kill("KILL")
    }, timeout)
    const failMap = (msg) => {
      err += msg
      try { fs.writeFileSync(fifo, "go\n") } catch { /* reader may be gone */ }
      child.kill("KILL")
    }
    child.stderr.on("data", (buf) => {
      err += buf.toString()
      if (!ready && err.includes("NSREADY")) {
        ready = true
        const uid = String(child.pid)
        const map = ["0", "1000", "1", "1000", "100000", "1", "2000", "100001", "1", "2001", "100002", "1", "2002", "100003", "1"]
        const u = spawnSync("newuidmap", [uid, ...map])
        const g = spawnSync("newgidmap", [uid, ...map])
        if (u.status !== 0 || g.status !== 0) {
          failMap(`\nuidmap ${u.stderr} ${g.stderr}\n`)
          return
        }
        if (stdin) child.stdin.write(stdin)
        child.stdin.end()
        try { fs.writeFileSync(fifo, "go\n") } catch (e) { err += String(e) }
      }
    })
    child.stdout.on("data", (buf) => { out += buf.toString() })
    child.on("close", (code) => {
      clearTimeout(timer)
      fs.rmSync(cmdFile, { force: true })
      try { fs.rmSync(fifo, { force: true }) } catch { /* fifo */ }
      resolve({
        code: code ?? 1,
        stdout: out,
        stderr: err.replace(/NSREADY\n?/, ""),
      })
    })
  })
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port))
  })
}

function startSsh() {
  const keyPath = path.join(LIVE, "host_key")
  if (!fs.existsSync(keyPath)) {
    spawnSync("ssh-keygen", ["-t", "ed25519", "-f", keyPath, "-N", "", "-q"])
  }
  const server = new Server({ hostKeys: [fs.readFileSync(keyPath)] }, (client) => {
    let user = null
    client.on("authentication", (ctx) => {
      const rec = users[ctx.username]
      if (ctx.method === "password" && rec && ctx.password === rec.password) {
        user = ctx.username
        ctx.accept()
      } else {
        ctx.reject(["password"])
      }
    })
    client.on("error", (err) => {
      fs.appendFileSync(path.join(LIVE, "ssh.log"), `\nclient error: ${err.message}\n`)
    })
    client.on("ready", () => {
      client.on("session", (accept) => {
        const session = accept()
        session.on("exec", (acceptExec, _reject, info) => {
          const stream = acceptExec()
          const chunks = []
          let started = false
          const start = () => {
            if (started) return
            started = true
            const stdin = Buffer.concat(chunks).toString()
            const command = info.command
            fs.appendFileSync(path.join(LIVE, "ssh.log"), `\n## ${user}\n${command.slice(0, 400)}\n`)
            if (/cat ~\/\.bashrc/.test(command)) {
              stream.write(users[user]?.bashrc || "")
              stream.exit(0)
              stream.end()
              return
            }
            runInNs(command, stdin, 90000).then((result) => {
              if (result.stdout) stream.write(result.stdout)
              if (result.stderr) stream.stderr.write(result.stderr)
              stream.exit(result.code ?? 1)
              stream.end()
            }).catch((err) => {
              stream.stderr.write(String(err))
              stream.exit(1)
              stream.end()
            })
          }
          let timer = setTimeout(start, 250)
          stream.on("data", (d) => {
            chunks.push(Buffer.from(d))
            clearTimeout(timer)
            timer = setTimeout(start, 250)
          })
          stream.on("end", () => {
            clearTimeout(timer)
            start()
          })
        })
      })
    })
  })
  return listen(server).then((port) => ({ server, port }))
}

const EXISTING_RANGE_YAML = `ludus: []
network:
  inter_vlan_default: DROP
  rules:
    - name: Allow targets to SO Fleet
      vlan_src: 10
      vlan_dst: 20
      protocol: tcp
      ports: "8220"
      action: ACCEPT
    - name: Allow clients to DC
      vlan_src: 10
      vlan_dst: 10
      protocol: tcp
      ports: "445"
      action: ACCEPT
`

function startLudus() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1")
    const key = req.headers["x-api-key"]
    const user = Object.values(users).find((u) => u.apiKey === key)
    const send = (status, body) => {
      const payload = typeof body === "string" ? body : JSON.stringify(body)
      res.writeHead(status, { "content-type": "application/json" })
      res.end(payload)
    }
    if (!user && url.pathname !== "/api/v2/" && url.pathname !== "/api/v2") {
      return send(401, { error: "unauthorized" })
    }
    if (req.method === "GET" && (url.pathname === "/api/v2/" || url.pathname === "/api/v2")) {
      return send(200, { result: "2.3.5", version: "2.3.5" })
    }
    if (req.method === "GET" && url.pathname === "/api/v2/user") {
      return send(200, {
        result: [{
          userID: user.userID,
          name: user.name,
          isAdmin: user.isAdmin,
          proxmoxUsername: user.proxmoxUsername,
        }],
      })
    }
    if (req.method === "GET" && url.pathname === "/api/v2/ranges/accessible") {
      return send(200, [{ rangeID: "range-alpha", rangeNumber: 2, accessType: "Direct" }])
    }
    if (req.method === "GET" && url.pathname === "/api/v2/range/config") {
      return send(200, { result: EXISTING_RANGE_YAML })
    }
    if (req.method === "GET" && url.pathname === "/api/v2/templates") {
      return send(200, [{ name: "debian-13-x64-server-template", built: true }])
    }
    if (req.method === "GET" && url.pathname === "/api/v2/sources/src-ok/templates") {
      return send(200, { templates: [{ name: "debian-13-x64-server-template" }] })
    }
    if (req.method === "GET" && url.pathname === "/api/v2/sources/src-sticky/templates") {
      return send(200, { templates: [{ name: "sticky-template" }] })
    }
    if (req.method === "GET" && /\/sources\/[^/]+\/(roles|collections|blueprints)$/.test(url.pathname)) {
      return send(200, [])
    }
    if (req.method === "GET" && url.pathname === "/api/v2/blueprints") return send(200, [])
    if (req.method === "DELETE" && url.pathname.startsWith("/api/v2/template/")) {
      return send(200, { result: "included template cannot be deleted" })
    }
    if (req.method === "GET" && url.pathname === "/api/v2/ansible") return send(200, [])
    fs.appendFileSync(path.join(LIVE, "ludus.log"), `${req.method} ${url.pathname}\n`)
    send(404, { error: "not mocked" })
  })
  return listen(server).then((port) => ({ server, port }))
}

function appEnv(extra) {
  return {
    ...process.env,
    APP_SECRET,
    DATA_DIR,
    LUDUS_SSH_HOST: "127.0.0.1",
    LUDUS_SSH_PORT: String(extra.sshPort),
    LUDUS_URL: `http://127.0.0.1:${extra.ludusPort}`,
    LUDUS_TLS_INSECURE: "true",
    DISABLE_HTTPS: "false",
    TRUST_PROXY_TLS: "",
    PROXMOX_SSH_USER: "luxuser",
    PROXMOX_SSH_PASSWORD: "luxpass",
    PROXMOX_SSH_KEY_PATH: path.join(LIVE, "no-key"),
    GOAD_PATH: "/opt/goad",
    LUDUS_INSTALL_PATH: "/opt/ludus",
    ENABLE_GOAD: "true",
    LUX_REPO_PATH: REPO,
    DOCKER_SOCKET_PATH: extra.dockerSocket,
    HOME: path.join(LIVE, "home"),
    NODE_ENV: PROD_UI ? "production" : "development",
    ...(PROD_UI ? { DISABLE_HTTPS: "true" } : {}),
    // Node 24 evaluates the TypeScript Tailwind config as ESM, so its require()
    // call aborts page compilation. Disabling the native stripper lets Tailwind's
    // own loader read the config, which is what next build already does.
    NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --no-experimental-strip-types`.trim(),
  }
}

function startNext(port, env) {
  const args = PROD_UI
    ? ["next", "start", "-p", String(port), "-H", "127.0.0.1"]
    : ["next", "dev", "--webpack", "-p", String(port), "-H", "127.0.0.1"]
  const child = spawn("npx", args, {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  })
  children.push(child)
  const log = fs.createWriteStream(path.join(LIVE, `next-${port}.log`))
  child.stdout.pipe(log)
  child.stderr.pipe(log)
  return child
}

async function waitHealth(port, tries = 120) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`)
      if (res.ok) return true
    } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 1000))
  }
  return false
}

async function login(port, username, password) {
  const res = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Production refuses plain HTTP unless the proxy marks the request HTTPS.
      ...(PROD_UI ? { "x-forwarded-proto": "https" } : {}),
    },
    body: JSON.stringify({ username, password }),
  })
  const text = await res.text()
  const cookie = (res.headers.getSetCookie?.() || []).find((c) => c.startsWith("ludus_session=")) || ""
  return { status: res.status, body: text, cookie: cookie.split(";")[0] }
}

async function authed(port, cookie, method, pathname, body) {
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    headers: {
      cookie,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  const nextCookie = (res.headers.getSetCookie?.() || []).find((c) => c.startsWith("ludus_session="))
  return { status: res.status, body: text, cookie: nextCookie ? nextCookie.split(";")[0] : cookie }
}

function storeKey(dir, key) {
  const result = spawnSync("node", ["scripts/lux-host/record-update-key.mjs"], {
    cwd: ROOT,
    input: key,
    env: { ...process.env, APP_SECRET, DATA_DIR: dir },
  })
  if (result.status !== 0) throw new Error(result.stderr.toString() || "record key failed")
}

function clearKey(dir) {
  const db = new DatabaseSync(path.join(dir, "ludus-ux.db"))
  db.prepare("DELETE FROM settings WHERE key = ?").run("luxHostUpdateKey")
  db.close()
}

function rangeRows(dir) {
  const db = new DatabaseSync(path.join(dir, "ludus-ux.db"))
  const rows = db.prepare("SELECT instance_id, range_id FROM goad_instance_ranges").all()
  db.close()
  return rows
}

async function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true })
  fs.mkdirSync(DATA_DIR, { recursive: true })
  await reclaimSandboxTree()
  writeTree()
  spawnSync("npm", ["run", "copy:monaco"], { cwd: ROOT, stdio: "inherit" })
  storeKey(DATA_DIR, UPDATE_KEY)

  const self = await runInNs("id -u; id -un; id -u alice; sudo -u alice id -un; sudo -u luxuser test -w " + JSON.stringify(path.join(REPO, "scripts/upgrade.sh")) + "; echo writable:$?")
  fs.writeFileSync(path.join(EVIDENCE, "ns-selftest.txt"), JSON.stringify(self, null, 2))
  if (self.code !== 0 || !self.stdout.includes("alice")) {
    scenario(
      "Sandbox can run lux-host as root and switch to the workspace owner",
      "fail",
      true,
      "ns-selftest.txt",
      self.stderr.slice(0, 500),
    )
  }

  const ssh = await startSsh()
  const ludus = await startLudus()
  const missingSocket = path.join(LIVE, "missing.sock")
  const nextPort = 3456
  startNext(nextPort, appEnv({ sshPort: ssh.port, ludusPort: ludus.port, dockerSocket: missingSocket }))
  const healthy = await waitHealth(nextPort)
  if (!healthy) {
    const log = fs.readFileSync(path.join(LIVE, `next-${nextPort}.log`), "utf8").slice(-2000)
    fs.writeFileSync(path.join(EVIDENCE, "next-failed.log"), log)
    scenario("LUX answers HTTP on the isolated dev server", "fail", false, "next-failed.log", "next dev did not become healthy")
    dump()
    return
  }

  const admin = await login(nextPort, "luxadmin", "adminpass")
  const user = await login(nextPort, "testuser", "userpass")
  fs.writeFileSync(path.join(EVIDENCE, "login-admin.json"), JSON.stringify(admin, null, 2))
  fs.writeFileSync(path.join(EVIDENCE, "login-user.json"), JSON.stringify({ status: user.status, body: user.body }, null, 2))
  scenario(
    "An admin signs in and the app reports that account as an admin",
    admin.status === 200 && admin.body.includes('"isAdmin":true') ? "pass" : "fail",
    true,
    "login-admin.json",
    "",
  )
  scenario(
    "A normal user signs in and the app reports that account as not an admin",
    user.status === 200 && user.body.includes('"isAdmin":false') ? "pass" : "fail",
    true,
    "login-user.json",
    "",
  )

  if (PROD_UI) {
    await driveUi(nextPort, admin.cookie)
    dump()
    return
  }

  clearKey(DATA_DIR)
  const hostNoKey = await authed(nextPort, admin.cookie, "GET", "/api/lux/releases/host")
  fs.writeFileSync(path.join(EVIDENCE, "host-without-key.json"), hostNoKey.body)
  let noKeyJson = {}
  try { noKeyJson = JSON.parse(hostNoKey.body) } catch { /* keep */ }
  scenario(
    "About does not offer a version switch over SSH when LUX has no lux-host update key",
    hostNoKey.status === 200 && noKeyJson.canSwitch === false && /lux-host install/i.test(noKeyJson.reason || "") ? "pass" : "fail",
    true,
    "host-without-key.json",
    "",
  )
  storeKey(DATA_DIR, UPDATE_KEY)

  const about = await authed(nextPort, admin.cookie, "GET", "/api/about")
  const aboutText = about.body
  fs.writeFileSync(path.join(EVIDENCE, "api-about-version.json"), aboutText.slice(0, 500))
  let aboutJson = {}
  try { aboutJson = JSON.parse(aboutText) } catch { /* keep raw */ }
  const changelogRes = await authed(nextPort, admin.cookie, "GET", "/api/changelog")
  const changelog = changelogRes.body
  fs.writeFileSync(path.join(EVIDENCE, "api-changelog-1.4.0.md"), changelog.slice(changelog.indexOf("## [1.4.0]"), changelog.indexOf("## [1.3.2]")))
  const section = changelog.slice(changelog.indexOf("## [1.4.0]"), changelog.indexOf("## [1.3.2]"))
  scenario(
    "The running app reports version 1.4.0 and the 1.4.0 notes are split into LUX and GOAD",
    aboutJson.version === "1.4.0" && section.includes("**LUX**") && section.includes("**GOAD**") ? "pass" : "fail",
    true,
    "api-changelog-1.4.0.md",
    "",
  )

  const host = await authed(nextPort, admin.cookie, "GET", "/api/lux/releases/host")
  fs.writeFileSync(path.join(EVIDENCE, "host-with-key.json"), host.body)
  let hostJson = {}
  try { hostJson = JSON.parse(host.body) } catch { /* keep */ }
  scenario(
    "With the update key stored, About reports the user-owned checkout can switch",
    host.status === 200 && hostJson.canSwitch === true && hostJson.repoPath === REPO ? "pass" : "fail",
    true,
    "host-with-key.json",
    "",
  )

  const noAck = await authed(nextPort, admin.cookie, "POST", "/api/lux/releases/switch", { tag: "v1.3.2", acknowledgeVersionManagementLoss: false })
  fs.writeFileSync(path.join(EVIDENCE, "switch-no-ack.json"), JSON.stringify(noAck, null, 2))
  scenario(
    "Downgrading below v1.4.0 without the acknowledgement is refused",
    noAck.status === 400 && noAck.body.includes("v1.4.0") ? "pass" : "fail",
    true,
    "switch-no-ack.json",
    "",
  )

  fs.writeFileSync(RECORD, "")
  const withAck = await authed(nextPort, admin.cookie, "POST", "/api/lux/releases/switch", { tag: "v1.3.2", acknowledgeVersionManagementLoss: true })
  fs.writeFileSync(path.join(EVIDENCE, "switch-with-ack.json"), JSON.stringify(withAck, null, 2))
  const recorded = fs.existsSync(RECORD) ? fs.readFileSync(RECORD, "utf8") : ""
  fs.writeFileSync(path.join(EVIDENCE, "upgrade-start-args.txt"), recorded)
  const checkoutScript = path.join(REPO, "scripts/upgrade.sh")
  const usedCheckout = recorded.includes(checkoutScript)
  const signedTemp = /SCRIPT_PATH=\/tmp\//.test(recorded) && /HAS_MARKER=no/.test(recorded) && /SCRIPT_UID=0/.test(recorded)
  scenario(
    "An acknowledged downgrade starts the signed temp script, not the caller-writable checkout copy",
    withAck.status === 202 && withAck.body.includes('"started":true') && signedTemp && !usedCheckout ? "pass" : "fail",
    true,
    "upgrade-start-args.txt",
    "",
  )

  const unsigned = "#!/bin/bash\necho PWNED\n"
  const bad = await runInNs(`sudo -n /usr/local/sbin/lux-host upgrade-start ${JSON.stringify(REPO)} v1.3.2`, unsigned)
  fs.writeFileSync(path.join(EVIDENCE, "unsigned-upgrade.txt"), JSON.stringify(bad, null, 2))
  scenario(
    "An unsigned bash body is rejected and is not scheduled as root",
    bad.code !== 0 && /hmac/i.test(bad.stderr) && !bad.stdout.includes("started") ? "pass" : "fail",
    true,
    "unsigned-upgrade.txt",
    "",
  )

  const keyFile = path.join(LIVE, "etc/lux-host.update-key")
  fs.renameSync(keyFile, keyFile + ".off")
  const missingHostKey = await runInNs(`sudo -n /usr/local/sbin/lux-host upgrade-probe ${JSON.stringify(REPO)}`, hmacBody("#!/bin/bash\necho hi\n"))
  fs.writeFileSync(path.join(EVIDENCE, "missing-host-key.txt"), JSON.stringify(missingHostKey, null, 2))
  fs.renameSync(keyFile + ".off", keyFile)
  scenario(
    "upgrade-probe does not report ok when the host update key file is missing",
    missingHostKey.code !== 0 && !/ok=yes/.test(missingHostKey.stdout) ? "pass" : "fail",
    true,
    "missing-host-key.txt",
    "",
  )

  fs.writeFileSync(RECORD, "")
  const writable = await runInNs(`sudo -n /usr/local/sbin/lux-host upgrade-start ${JSON.stringify(REPO)} v1.3.2`, "")
  fs.writeFileSync(path.join(EVIDENCE, "writable-checkout.txt"), JSON.stringify(writable, null, 2))
  scenario(
    "A caller-writable scripts/upgrade.sh is not executed as root when no signed body is sent",
    writable.code !== 0 && /writable by the caller/i.test(writable.stderr) && !fs.readFileSync(RECORD, "utf8").includes("systemd-run") ? "pass" : "fail",
    true,
    "writable-checkout.txt",
    "",
  )

  const denied = await authed(nextPort, user.cookie, "POST", "/api/auth/impersonate", {
    apiKey: users.testuser.apiKey,
    username: "testuser",
  })
  fs.writeFileSync(path.join(EVIDENCE, "impersonate-nonadmin.json"), JSON.stringify(denied, null, 2))
  scenario(
    "A non-admin cannot impersonate another user",
    denied.status === 403 ? "pass" : "fail",
    true,
    "impersonate-nonadmin.json",
    "",
  )

  const allowed = await authed(nextPort, admin.cookie, "POST", "/api/auth/impersonate", {
    apiKey: users.testuser.apiKey,
    ludusPrincipal: "testuser",
    username: "testuser",
  })
  fs.writeFileSync(path.join(EVIDENCE, "impersonate-admin.json"), JSON.stringify({ status: allowed.status, body: allowed.body }, null, 2))
  scenario(
    "An admin can impersonate another Ludus user",
    allowed.status === 200 && allowed.body.includes('"ok":true') ? "pass" : "fail",
    true,
    "impersonate-admin.json",
    "",
  )

  const install = await authed(nextPort, admin.cookie, "POST", "/api/settings/install-lux-host", {
    rootPassword: "",
    proxmoxSshUser: "luxuser",
    sshHost: "127.0.0.1",
  })
  fs.writeFileSync(path.join(EVIDENCE, "install-empty-root-password.json"), JSON.stringify(install, null, 2))
  scenario(
    "Settings refuses to install lux-host when the root password is blank",
    install.status === 400 && /root password is required/i.test(install.body) ? "pass" : "fail",
    true,
    "install-empty-root-password.json",
    "",
  )

  const linked = await authed(nextPort, allowed.cookie, "POST", "/api/goad/instances/set-range", {
    rangeId: "range-alpha",
    instanceIds: ["inst1"],
  })
  const owner = await runInNs("stat -c '%u %U' /opt/goad/workspace/inst1/.goad_range_id; echo ---; cat /opt/goad/workspace/inst1/.goad_range_id; echo; stat -c '%u %U' /opt/goad/workspace/inst1")
  const rows = rangeRows(DATA_DIR)
  fs.writeFileSync(path.join(EVIDENCE, "range-id-write.json"), JSON.stringify({ linked, owner, rows }, null, 2))
  scenario(
    "Provide writes .goad_range_id as the workspace owner after chown, then records it",
    linked.status === 200 && owner.stdout.includes("range-alpha") && /2000\s+alice/.test(owner.stdout) && rows.some((r) => r.instance_id === "inst1" && r.range_id === "range-alpha") ? "pass" : "fail",
    true,
    "range-id-write.json",
    "",
  )

  const missed = await authed(nextPort, allowed.cookie, "POST", "/api/goad/instances/set-range", {
    rangeId: "range-missing",
    instanceIds: ["does-not-exist"],
  })
  const rowsAfter = rangeRows(DATA_DIR)
  fs.writeFileSync(path.join(EVIDENCE, "range-id-failed.json"), JSON.stringify({ missed, rowsAfter }, null, 2))
  scenario(
    "A failed range-id write does not update SQLite",
    missed.status === 207 && !rowsAfter.some((r) => r.instance_id === "does-not-exist") ? "pass" : "fail",
    true,
    "range-id-failed.json",
    "",
  )

  const unpublished = await authed(nextPort, admin.cookie, "POST", "/api/sources/src-ok/publish", { published: false })
  const kept = fs.existsSync(path.join(LIVE, "opt/ludus/sources/src-1/templates/debian13/KEEP"))
  const installGone = !fs.existsSync(path.join(LIVE, "opt/ludus/packer/debian13"))
    && !fs.existsSync(path.join(LIVE, "opt/ludus/users/alice/packer/debian-13-x64-server-template"))
  fs.writeFileSync(path.join(EVIDENCE, "unpublish-ok.json"), JSON.stringify({ unpublished, kept, installGone }, null, 2))
  scenario(
    "Unpublish removes the installed template directories and leaves the source checkout",
    unpublished.status === 200 && !unpublished.body.includes("still on the Ludus host") && kept && installGone ? "pass" : "fail",
    true,
    "unpublish-ok.json",
    "",
  )

  const sticky = path.join(LIVE, "opt/ludus/packer/sticky-template")
  fs.mkdirSync(sticky, { recursive: true })
  fs.writeFileSync(path.join(sticky, "pin.txt"), "stuck\n")
  fs.writeFileSync(path.join(LIVE, "opt/ludus/.sticky-ro"), "1\n")
  const warned = await authed(nextPort, admin.cookie, "POST", "/api/sources/src-sticky/publish", { published: false })
  const stickyRemains = fs.existsSync(path.join(sticky, "pin.txt"))
  fs.writeFileSync(path.join(EVIDENCE, "unpublish-warn.json"), JSON.stringify({ warned, stickyRemains }, null, 2))
  scenario(
    "Unpublish warns when an install directory is still present and does not claim the source checkout blocked it",
    warned.status === 200 && /still on the Ludus host/.test(warned.body) && stickyRemains && kept ? "pass" : "fail",
    true,
    "unpublish-warn.json",
    "",
  )

  await driveUi(nextPort, admin.cookie)
  await driveDocker(ssh.port, ludus.port)
  await driveQuickstart(ssh.port)
  dump()
}

async function readWizardYaml(page, needle = "inter_vlan_default") {
  const editor = page.locator(".monaco-editor").last()
  await editor.waitFor({ timeout: 20000 })
  await page.waitForFunction((expected) => {
    const monaco = window.monaco
    const text = monaco?.editor?.getModels?.().map((model) => model.getValue()).join("\n") || ""
    return text.includes(expected)
  }, needle, { timeout: 20000 }).catch(() => {})
  const fromModel = await page.evaluate(() => {
    const monaco = window.monaco
    if (!monaco?.editor?.getModels) return ""
    return monaco.editor.getModels().map((model) => model.getValue()).join("\n")
  })
  if (fromModel.includes("network:")) return fromModel
  return editor.locator(".view-lines").innerText()
}

async function driveUi(port, cookie) {
  let browser
  try {
    browser = await chromium.launch({ headless: true })
  } catch (err) {
    fs.writeFileSync(path.join(EVIDENCE, "ui-error.txt"), String(err))
    scenario("Settings About shows v1.4.0 and the downgrade acknowledgement", "fail", true, "ui-error.txt", String(err).slice(0, 400))
    scenario("The GOAD wizard shows existing range rules and an empty editor clears them", "fail", true, "ui-error.txt", String(err).slice(0, 400))
    return
  }
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const eq = cookie.indexOf("=")
  const cookieName = cookie.slice(0, eq)
  const raw = cookie.slice(eq + 1)
  await context.addCookies([{
    name: cookieName,
    value: decodeURIComponent(raw),
    url: `http://127.0.0.1:${port}`,
    secure: cookieName.startsWith("__Host-"),
  }])
  const page = await context.newPage()
  try {
    await page.goto(`http://127.0.0.1:${port}/settings?tab=about`, { waitUntil: "domcontentloaded", timeout: 120000 })
    await page.getByText("v1.4.0").first().waitFor({ timeout: 30000 })
    await page.screenshot({ path: path.join(EVIDENCE, "about-version.png"), fullPage: true })
    scenario(
      "Settings About shows v1.4.0 on the running page",
      "pass",
      true,
      "about-version.png",
      "",
    )
    await page.getByRole("button", { name: "Release notes" }).click()
    await page.getByText("In-app releases").first().waitFor({ timeout: 20000 })
    const notes = await page.locator("body").innerText()
    await page.screenshot({ path: path.join(EVIDENCE, "about-changelog.png"), fullPage: true })
    scenario(
      "The About release notes show separate LUX and GOAD sections for 1.4.0",
      notes.includes("LUX") && notes.includes("GOAD") && notes.includes("Firewall rules") ? "pass" : "fail",
      true,
      "about-changelog.png",
      "",
    )
    const showMore = page.getByRole("button", { name: /Show \d+ more/ })
    if (await showMore.count()) await showMore.click()
    const downgrade = page.getByRole("button", { name: "Downgrade" }).first()
    await downgrade.waitFor({ timeout: 20000 })
    await downgrade.click()
    await page.getByText("older than v1.4.0").waitFor({ timeout: 10000 })
    const confirm = page.getByRole("button", { name: "Downgrade" }).last()
    const blocked = await confirm.isDisabled()
    await page.screenshot({ path: path.join(EVIDENCE, "downgrade-ack-required.png") })
    await page.locator("#lux-lose-version-mgmt").click()
    const enabled = await confirm.isEnabled()
    await page.screenshot({ path: path.join(EVIDENCE, "downgrade-ack-checked.png") })
    scenario(
      "The downgrade dialog stays blocked until the operator acknowledges losing in-app version management",
      blocked && enabled ? "pass" : "fail",
      true,
      "downgrade-ack-required.png",
      "",
    )
  } catch (err) {
    fs.writeFileSync(path.join(EVIDENCE, "ui-error.txt"), String(err))
    try { await page.screenshot({ path: path.join(EVIDENCE, "ui-error.png"), fullPage: true }) } catch { /* page */ }
    scenario("Settings About shows v1.4.0 and the downgrade acknowledgement", "fail", true, "ui-error.txt", String(err).slice(0, 400))
  }

  try {
    await page.goto(`http://127.0.0.1:${port}/goad/new`, { waitUntil: "domcontentloaded", timeout: 120000 })
    await page.getByRole("button", { name: /mini/ }).click({ timeout: 30000 })
    await page.getByRole("button", { name: "Next" }).click()
    const fleetRow = page.locator("div.rounded-lg").filter({ has: page.locator("code", { hasText: /^fleet$/ }) })
    const fleetBox = fleetRow.getByRole("checkbox")
    await fleetBox.waitFor({ timeout: 20000 })
    for (let i = 0; i < 40 && !(await fleetBox.isEnabled()); i++) {
      await page.waitForTimeout(250)
    }
    await fleetRow.click()
    await page.getByText("1 selected").waitFor({ timeout: 5000 })
    await page.getByRole("button", { name: "Next" }).click()
    await page.getByRole("button", { name: "Use Existing Range" }).click()
    await page.locator("div.grid").getByRole("button", { name: /range-alpha/ }).click()
    await page.getByRole("button", { name: "Next" }).click()
    await page.getByText("allow-443").waitFor({ timeout: 30000 })
    await page.screenshot({ path: path.join(EVIDENCE, "network-rules-editor.png"), fullPage: true })
    const editor = await page.locator("body").innerText()
    const dc = editor.indexOf("Allow clients to DC")
    const fleet = editor.indexOf("Allow targets to SO Fleet")
    const extra = editor.indexOf("allow-443")
    const once = editor.split("Allow targets to SO Fleet").length === 2
    scenario(
      "The Network Rules step lists the existing range rule before new rules and does not duplicate a shared name",
      dc >= 0 && fleet > dc && extra > fleet && once ? "pass" : "fail",
      true,
      "network-rules-editor.png",
      `dc=${dc} fleet=${fleet} extra=${extra} once=${once}`,
    )
    await page.getByRole("button", { name: "Next" }).last().click()
    await page.getByText("Generated Configuration").waitFor({ timeout: 20000 })
    const yaml = await readWizardYaml(page)
    fs.writeFileSync(path.join(EVIDENCE, "generated-network.yaml"), yaml)
    await page.screenshot({ path: path.join(EVIDENCE, "generated-network.png"), fullPage: true })
    const names = [...yaml.matchAll(/- name: (.+)/g)].map((m) => m[1].trim())
    scenario(
      "The generated config keeps inter_vlan_default and orders rules so existing rules evaluate before new ones",
      yaml.includes("inter_vlan_default: DROP") && names[0] === "allow-443" && names.at(-1) === "Allow clients to DC" && names.filter((n) => n === "Allow targets to SO Fleet").length === 1 ? "pass" : "fail",
      true,
      "generated-network.yaml",
      names.join(" | "),
    )
    await page.getByRole("button", { name: "Back" }).click()
    await page.getByText("Firewall Rules").waitFor({ timeout: 15000 })
    await page.getByText("Allow clients to DC").waitFor({ timeout: 15000 })
    const trash = page.locator("button:has(svg.lucide-trash2)")
    await trash.first().waitFor({ timeout: 15000 })
    for (let i = 0; i < 8 && await trash.count(); i++) {
      await trash.first().click()
    }
    await page.getByText("Allow clients to DC").waitFor({ state: "hidden", timeout: 5000 })
    await page.getByRole("button", { name: "Next" }).last().click()
    await page.getByText("Generated Configuration").waitFor({ timeout: 20000 })
    const emptyYaml = await readWizardYaml(page, "rules: []")
    fs.writeFileSync(path.join(EVIDENCE, "empty-network.yaml"), emptyYaml)
    await page.screenshot({ path: path.join(EVIDENCE, "empty-network.png"), fullPage: true })
    scenario(
      "Clearing the Network Rules editor writes rules: [] and keeps the existing range inter_vlan_default",
      /rules:\s*\[\s*\]/.test(emptyYaml) && emptyYaml.includes("inter_vlan_default: DROP") && !emptyYaml.includes("Allow clients to DC") ? "pass" : "fail",
      true,
      "empty-network.yaml",
      emptyYaml.slice(0, 400),
    )
  } catch (err) {
    fs.writeFileSync(path.join(EVIDENCE, "network-ui-error.txt"), String(err))
    try { await page.screenshot({ path: path.join(EVIDENCE, "network-ui-error.png"), fullPage: true }) } catch { /* page */ }
    scenario(
      "The GOAD wizard shows existing range rules and an empty editor clears them",
      "fail",
      true,
      "network-ui-error.txt",
      String(err).slice(0, 500),
    )
  }
  await browser.close()
}

function startDockerStub() {
  const socketPath = path.join(LIVE, "docker.sock")
  try { fs.rmSync(socketPath, { force: true }) } catch { /* none */ }
  const containers = new Map()
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost")
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString()
    const send = (status, body) => {
      const payload = typeof body === "string" ? body : JSON.stringify(body)
      res.writeHead(status, { "content-type": "application/json" })
      res.end(payload)
    }
    if (req.method === "GET" && url.pathname.includes("/containers/") && url.pathname.endsWith("/json")) {
      return send(404, { message: "no such container" })
    }
    if (req.method === "GET" && url.pathname.startsWith("/v1.43/images/")) {
      return send(200, { Id: "sha256:lux" })
    }
    if (req.method === "POST" && url.pathname === "/v1.43/containers/create") {
      const body = JSON.parse(raw)
      const id = crypto.randomBytes(8).toString("hex")
      containers.set(id, { script: body.Cmd?.[0] || "", logs: "", code: 0 })
      return send(201, { Id: id })
    }
    const id = url.pathname.split("/")[3]
    const item = containers.get(id)
    if (req.method === "POST" && url.pathname.endsWith("/start") && item) {
      const result = spawnSync("bash", ["-c", item.script], {
        env: {
          PATH: `${path.join(LIVE, "bin")}:/usr/bin:/bin`,
          HOME: path.join(LIVE, "home"),
          LUX_SYSTEMD_RECORD: path.join(LIVE, "docker-systemd.txt"),
        },
        encoding: "utf8",
      })
      item.logs = `${result.stdout || ""}${result.stderr || ""}`
      item.code = result.status ?? 1
      return send(204, "")
    }
    if (req.method === "POST" && url.pathname.endsWith("/wait") && item) {
      return send(200, { StatusCode: item.code })
    }
    if (req.method === "GET" && url.pathname.endsWith("/logs") && item) {
      res.writeHead(200, { "content-type": "text/plain" })
      res.end(item.logs)
      return
    }
    if (req.method === "DELETE" && url.pathname.includes("/containers/")) {
      containers.delete(id)
      return send(204, "")
    }
    send(500, { message: `unhandled ${req.method} ${url.pathname}` })
  })
  return new Promise((resolve) => {
    server.listen(socketPath, () => resolve({ server, socketPath }))
  })
}

async function driveDocker(sshPort, ludusPort) {
  const docker = await startDockerStub()
  const port = 3457
  const dataDir = path.join(LIVE, "data-docker")
  fs.mkdirSync(dataDir, { recursive: true })
  const env = appEnv({ sshPort, ludusPort, dockerSocket: docker.socketPath })
  env.DATA_DIR = dataDir
  env.LUX_HOST_EXEC_IMAGE = "lux-test:local"
  startNext(port, env)
  const healthy = await waitHealth(port, 180)
  if (!healthy) {
    scenario(
      "The Docker socket path can switch without a lux-host update key",
      "fail",
      false,
      "next-3457.log",
      "second dev server did not become healthy",
    )
    return
  }
  const admin = await login(port, "luxadmin", "adminpass")
  const host = await authed(port, admin.cookie, "GET", "/api/lux/releases/host")
  fs.writeFileSync(path.join(EVIDENCE, "docker-host.json"), host.body)
  let parsed = {}
  try { parsed = JSON.parse(host.body) } catch { /* keep */ }
  const started = await authed(port, admin.cookie, "POST", "/api/lux/releases/switch", {
    tag: "v1.3.2",
    acknowledgeVersionManagementLoss: true,
  })
  fs.writeFileSync(path.join(EVIDENCE, "docker-switch.json"), JSON.stringify(started, null, 2))
  scenario(
    "The Docker socket path reports the checkout can switch and starts a downgrade without the update key",
    parsed.canSwitch === true && started.status === 202 ? "pass" : "fail",
    true,
    "docker-host.json",
    "",
  )
}

function decryptSettings(stored) {
  const raw = Buffer.from(stored.slice("enc:v2:".length), "base64")
  const key = crypto.pbkdf2Sync(APP_SECRET, Buffer.from("ludus-ux-settings-salt-v1"), 100000, 32, "sha256")
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12))
  decipher.setAuthTag(raw.subarray(12, 28))
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8")
}

async function driveQuickstart(sshPort) {
  const envFile = path.join(ROOT, ".env")
  if (fs.existsSync(envFile)) {
    scenario(
      "Quickstart installs lux-host, creates the update key, and records it",
      "untested",
      false,
      "",
      "A .env already exists in the worktree. Quickstart would overwrite it, so this run did not start the installer.",
    )
    return
  }
  const home = path.join(LIVE, "qs-home")
  fs.mkdirSync(home, { recursive: true })
  fs.writeFileSync(envFile, [
    `LUDUS_SSH_HOST=127.0.0.1`,
    `LUDUS_SSH_PORT=${sshPort}`,
    `PROXMOX_SSH_USER=luxuser`,
    `PROXMOX_SSH_PASSWORD=luxpass`,
    `SSH_KEY_PATH=${path.join(LIVE, "qs-keys")}`,
    `APP_SECRET=${APP_SECRET}`,
    `DATA_DIR=${DATA_DIR}`,
    "",
  ].join("\n"))
  const script = `
set +e
export HOME=${JSON.stringify(home)}
export PATH=${JSON.stringify(path.join(LIVE, "bin"))}:$PATH
export DATA_DIR=${JSON.stringify(DATA_DIR)}
source ${JSON.stringify(path.join(ROOT, "scripts/quickstart.sh"))}
printf 'y\\n' | lux_offer_scoped_host_sudo luxuser
echo QS_EXIT:$?
`
  const result = spawnSync("bash", ["-c", script], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 120000,
    env: { ...process.env, HOME: home, PATH: `${path.join(LIVE, "bin")}:${process.env.PATH}`, DATA_DIR },
  })
  fs.rmSync(envFile, { force: true })
  const out = `${result.stdout || ""}\n${result.stderr || ""}`
  fs.writeFileSync(path.join(EVIDENCE, "quickstart.txt"), out.slice(-4000))
  const hostKey = fs.readFileSync(path.join(LIVE, "etc/lux-host.update-key"), "utf8").trim()
  let stored = ""
  let matches = false
  try {
    const db = new DatabaseSync(path.join(DATA_DIR, "ludus-ux.db"))
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("luxHostUpdateKey")
    db.close()
    stored = decryptSettings(String(row?.value || ""))
    matches = stored === hostKey && /^[0-9a-f]{64}$/.test(hostKey)
  } catch (err) {
    fs.appendFileSync(path.join(EVIDENCE, "quickstart.txt"), `\ndecrypt: ${err}\n`)
  }
  const summary = { exit: result.status, signal: result.signal, matches, keyLen: hostKey.length, installed: out.includes("Installed.") }
  fs.writeFileSync(path.join(EVIDENCE, "quickstart.json"), JSON.stringify(summary, null, 2))
  scenario(
    "Quickstart installs lux-host, creates the update key, and records it the way Settings does",
    matches && out.includes("Installed.") ? "pass" : "fail",
    true,
    "quickstart.json",
    matches ? "" : out.slice(-500),
  )
}

function dump() {
  fs.writeFileSync(path.join(EVIDENCE, "scenarios.json"), JSON.stringify(scenarios, null, 2))
  console.log("HARNESS_DONE")
  for (const child of children) {
    try { child.kill("SIGTERM") } catch { /* gone */ }
  }
}

process.on("SIGINT", () => { dump(); process.exit(1) })
main().catch((err) => {
  fs.mkdirSync(EVIDENCE, { recursive: true })
  fs.writeFileSync(path.join(EVIDENCE, "harness-error.txt"), String(err?.stack || err))
  console.error(err)
  dump()
  process.exit(1)
})
