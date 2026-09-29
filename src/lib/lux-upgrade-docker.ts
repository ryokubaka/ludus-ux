import { randomBytes } from "node:crypto"
import fs from "node:fs"
import http from "node:http"

/** Host docker daemon socket. Compose mounts this into the app container. */
export const DOCKER_SOCKET_PATH = process.env.DOCKER_SOCKET_PATH || "/var/run/docker.sock"

export function dockerApiVersion(): string {
  const raw = (process.env.LUX_DOCKER_API_VERSION || "v1.43").trim() || "v1.43"
  return raw.startsWith("v") ? raw : `v${raw}`
}

export function dockerSocketAvailable(): boolean {
  try {
    fs.accessSync(DOCKER_SOCKET_PATH, fs.constants.R_OK | fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

export type HostExecContainer = {
  Image: string
  Tty: true
  Entrypoint: string[]
  Cmd: string[]
  HostConfig: { Privileged: true; PidMode: "host"; CgroupnsMode: "host" }
}

/**
 * One-shot container that enters the host namespaces and runs `script`
 * with the host's own `git` and `docker`. `image` must contain `/usr/bin/nsenter`.
 */
export function buildHostExecContainer(script: string, image: string): HostExecContainer {
  return {
    Image: image,
    Tty: true,
    Entrypoint: ["/usr/bin/nsenter", "-t", "1", "-w/", "-m", "-u", "-i", "-n", "-p", "--", "/bin/sh", "-c"],
    Cmd: [script],
    HostConfig: { Privileged: true, PidMode: "host", CgroupnsMode: "host" },
  }
}

type DockerResult = { status: number; body: string }

function dockerApi(method: string, apiPath: string, body?: unknown, timeoutMs = 60_000): Promise<DockerResult> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body)
    const req = http.request(
      {
        socketPath: DOCKER_SOCKET_PATH,
        path: `/${dockerApiVersion()}${apiPath}`,
        method,
        headers: payload
          ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
          : {},
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on("data", (chunk: Buffer) => chunks.push(chunk))
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") })
        })
      },
    )
    req.on("timeout", () => {
      req.destroy(new Error("Docker API request timed out"))
    })
    req.on("error", reject)
    if (payload) req.write(payload)
    req.end()
  })
}

function dockerError(body: string, status: number): Error {
  try {
    const parsed = JSON.parse(body) as { message?: string }
    if (parsed.message) return new Error(parsed.message)
  } catch {
    // Docker sometimes returns plain text.
  }
  const text = body.trim()
  return new Error(text || `Docker API HTTP ${status}`)
}

function imageCreateQuery(image: string): string {
  const at = image.lastIndexOf("@")
  if (at > image.lastIndexOf("/")) return `fromImage=${encodeURIComponent(image)}`
  const slash = image.lastIndexOf("/")
  const colon = image.lastIndexOf(":")
  if (colon <= slash) return `fromImage=${encodeURIComponent(image)}`
  return `fromImage=${encodeURIComponent(image.slice(0, colon))}&tag=${encodeURIComponent(image.slice(colon + 1))}`
}

function pullStreamError(body: string): string | null {
  for (const line of body.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as { error?: string }
      if (parsed.error) return parsed.error
    } catch {
      continue
    }
  }
  return null
}

function containerNameCandidates(): string[] {
  const names: string[] = []
  try {
    const host = fs.readFileSync("/etc/hostname", "utf8").trim()
    if (host) names.push(host)
  } catch {
    // The process is not running in a container with a hostname file.
  }
  if (!names.includes("ludus-ux")) names.push("ludus-ux")
  return names
}

async function resolveHostExecImage(): Promise<{ image: string; allowPull: boolean }> {
  const configured = process.env.LUX_HOST_EXEC_IMAGE?.trim()
  if (configured) return { image: configured, allowPull: true }
  for (const name of containerNameCandidates()) {
    const inspected = await dockerApi("GET", `/containers/${encodeURIComponent(name)}/json`)
    if (inspected.status !== 200) continue
    try {
      const image = (JSON.parse(inspected.body) as { Image?: string }).Image?.trim()
      if (image) return { image, allowPull: false }
    } catch {
      continue
    }
  }
  throw new Error("Could not find this container's image, which must include /usr/bin/nsenter")
}

async function ensureHostExecImage(image: string, allowPull: boolean): Promise<void> {
  const inspect = await dockerApi("GET", `/images/${encodeURIComponent(image)}/json`)
  if (inspect.status === 200) return
  if (!allowPull) throw new Error("The host helper image is not on the local Docker daemon")
  if (inspect.status !== 404) throw dockerError(inspect.body, inspect.status)
  const pulled = await dockerApi("POST", `/images/create?${imageCreateQuery(image)}`, undefined, 300_000)
  if (pulled.status >= 300) throw dockerError(pulled.body, pulled.status)
  const streamError = pullStreamError(pulled.body)
  if (streamError) throw new Error(streamError)
}

/** Run a shell script on the Docker host and return its stdout. */
export async function runHostScriptViaDocker(script: string): Promise<string> {
  const name = `lux-host-exec-${randomBytes(4).toString("hex")}`
  let id = ""
  try {
    const hostExec = await resolveHostExecImage()
    await ensureHostExecImage(hostExec.image, hostExec.allowPull)
    const created = await dockerApi(
      "POST",
      `/containers/create?name=${encodeURIComponent(name)}`,
      buildHostExecContainer(script, hostExec.image),
    )
    if (created.status >= 300) throw dockerError(created.body, created.status)
    const parsed = JSON.parse(created.body) as { Id?: string }
    if (!parsed.Id) throw new Error("Docker did not return a container id")
    id = parsed.Id

    const started = await dockerApi("POST", `/containers/${id}/start`)
    if (started.status >= 300) throw dockerError(started.body, started.status)

    const waited = await dockerApi("POST", `/containers/${id}/wait`, undefined, 120_000)
    if (waited.status >= 300) throw dockerError(waited.body, waited.status)
    const statusCode = (JSON.parse(waited.body) as { StatusCode?: number }).StatusCode

    const logs = await dockerApi("GET", `/containers/${id}/logs?stdout=1&stderr=1`)
    const text = logs.status < 300 ? logs.body.replace(/\r/g, "").trim() : ""
    if (statusCode !== 0) {
      throw new Error(text || `Host command exited ${statusCode ?? "unknown"}`)
    }
    return text
  } finally {
    if (id) {
      await dockerApi("DELETE", `/containers/${id}?force=1`).catch(() => undefined)
    }
  }
}
