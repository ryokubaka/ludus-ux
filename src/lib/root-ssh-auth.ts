/**
 * Root SSH authentication to the Ludus/Proxmox host.
 *
 * Prefers password when set (settings or env); otherwise uses a private key
 * from PROXMOX_SSH_KEY_PATH, GOAD_SSH_KEY_PATH, or default container paths.
 *
 * Note: Proxmox HTTP API login (noVNC in-browser) still requires a PAM password
 * or API token — see hasProxmoxPamOrSessionPassword().
 */

import * as fs from "fs"
import * as path from "path"
import type { ConnectConfig } from "ssh2"
import { getSettings, type RuntimeSettings } from "./settings-store"

/** OpenSSH PEM keys from Windows bind mounts often contain CRLF; ssh2 parsing may fail without normalization. */
function normalizePrivateKeyBuffer(buf: Buffer): Buffer {
  const s = buf.toString("utf8")
  if (!/\r/.test(s)) return buf
  return Buffer.from(s.replace(/\r\n/g, "\n").replace(/\r/g, "\n"), "utf8")
}

/**
 * Search order: optional `effective.proxmoxSshKeyPath` (Settings UI / draft), then SQLite
 * `proxmoxSshKeyPath`, then PROXMOX_SSH_KEY_PATH / GOAD_SSH_KEY_PATH env, then defaults.
 */
export function getPrivateKeySearchPathsFor(
  effective?: Pick<RuntimeSettings, "proxmoxSshKeyPath"> | null,
): string[] {
  let first = ""
  if (effective && typeof effective.proxmoxSshKeyPath === "string") {
    first = effective.proxmoxSshKeyPath.trim()
  }
  if (!first) {
    try {
      first = getSettings().proxmoxSshKeyPath?.trim() || ""
    } catch {
      /* DB / bootstrap not ready */
    }
  }
  const parts = [
    first || undefined,
    process.env.PROXMOX_SSH_KEY_PATH?.trim(),
    process.env.GOAD_SSH_KEY_PATH?.trim(),
  ].filter(Boolean) as string[]
  const defaults = ["/app/ssh/id_rsa", "/app/ssh/id_ed25519"]
  const discovered = discoverAppSshKeyPaths()
  return [...new Set([...parts, ...defaults, ...discovered])]
}

/**
 * Paths under /app/ssh built from readdir names (exact bytes). Fixes cases where the
 * key is visible in the folder but the literal path `/app/ssh/id_rsa` does not work:
 * different casing on a case-sensitive FS, trailing characters in the filename, etc.
 */
function discoverAppSshKeyPaths(): string[] {
  const dir = "/app/ssh"
  try {
    if (!fs.existsSync(dir)) return []
    if (!fs.statSync(dir).isDirectory()) return []
    return fs
      .readdirSync(dir)
      .filter((n) => n.length > 0 && n !== ".gitkeep" && !n.startsWith("."))
      .map((n) => path.join(dir, n))
  } catch {
    return []
  }
}

export function getPrivateKeySearchPaths(): string[] {
  return getPrivateKeySearchPathsFor(undefined)
}

function errnoCode(e: unknown): string {
  return e instanceof Error && "code" in e ? String((e as NodeJS.ErrnoException).code) : ""
}

/**
 * Inspect one key path using lstat first (then follow for non-links).
 * Symlinks, permission errors, and non-files are surfaced in probe output.
 */
function inspectKeyPath(p: string): {
  path: string
  /** True if lstat succeeds (something named `p` exists: file, dir, or symlink). */
  exists: boolean
  isSymlink: boolean
  linkTarget?: string
  danglingSymlink?: boolean
  isFile: boolean
  size: number
  readable: boolean
  readError?: string
} {
  let lst: fs.Stats
  try {
    lst = fs.lstatSync(p)
  } catch (e) {
    if (errnoCode(e) === "ENOENT") {
      return { path: p, exists: false, isSymlink: false, isFile: false, size: 0, readable: false }
    }
    return {
      path: p,
      exists: false,
      isSymlink: false,
      isFile: false,
      size: 0,
      readable: false,
      readError: e instanceof Error ? e.message : String(e),
    }
  }

  if (lst.isSymbolicLink()) {
    let target = ""
    try {
      target = fs.readlinkSync(p)
    } catch (e) {
      return {
        path: p,
        exists: true,
        isSymlink: true,
        isFile: false,
        size: 0,
        readable: false,
        readError: e instanceof Error ? e.message : String(e),
      }
    }
    let st: fs.Stats
    try {
      st = fs.statSync(p)
    } catch {
      return {
        path: p,
        exists: true,
        isSymlink: true,
        linkTarget: target,
        danglingSymlink: true,
        isFile: false,
        size: 0,
        readable: false,
        readError:
          `Dangling symlink → ${target}: target does not resolve inside this container. ` +
          `Replace with a real file in your SSH mount (cp the key, do not use ln -s to a path that only exists on another host).`,
      }
    }
    if (!st.isFile()) {
      return {
        path: p,
        exists: true,
        isSymlink: true,
        linkTarget: target,
        isFile: false,
        size: 0,
        readable: false,
        readError: "Symlink does not point to a regular file",
      }
    }
    try {
      const buf = fs.readFileSync(p)
      if (buf.length === 0) {
        return {
          path: p,
          exists: true,
          isSymlink: true,
          linkTarget: target,
          isFile: true,
          size: st.size,
          readable: false,
          readError: "File is empty",
        }
      }
      return {
        path: p,
        exists: true,
        isSymlink: true,
        linkTarget: target,
        isFile: true,
        size: st.size,
        readable: true,
      }
    } catch (e) {
      return {
        path: p,
        exists: true,
        isSymlink: true,
        linkTarget: target,
        isFile: true,
        size: st.size,
        readable: false,
        readError: e instanceof Error ? e.message : String(e),
      }
    }
  }

  if (!lst.isFile()) {
    return {
      path: p,
      exists: true,
      isSymlink: false,
      isFile: false,
      size: 0,
      readable: false,
      readError: lst.isDirectory() ? "Path is a directory, not a key file" : "Not a regular file",
    }
  }

  try {
    const buf = fs.readFileSync(p)
    if (buf.length === 0) {
      return {
        path: p,
        exists: true,
        isSymlink: false,
        isFile: true,
        size: lst.size,
        readable: false,
        readError: "File is empty",
      }
    }
    return { path: p, exists: true, isSymlink: false, isFile: true, size: lst.size, readable: true }
  } catch (e) {
    return {
      path: p,
      exists: true,
      isSymlink: false,
      isFile: true,
      size: lst.size,
      readable: false,
      readError: e instanceof Error ? e.message : String(e),
    }
  }
}

/** Admin diagnostics: what the Node process actually sees for keys and /app/ssh. */
export type KeyPathInspect = {
  path: string
  exists: boolean
  isSymlink: boolean
  linkTarget?: string
  danglingSymlink?: boolean
  isFile: boolean
  size: number
  readable: boolean
  readError?: string
}

export function probeSshKeyMount(
  effective?: Pick<RuntimeSettings, "proxmoxSshKeyPath"> | null,
): {
  env: { PROXMOX_SSH_KEY_PATH?: string; GOAD_SSH_KEY_PATH?: string }
  settingsKeyPath: string
  effectiveKeyPath?: string
  sshDirListing: string[] | null
  sshDirError?: string
  /** Per-name stats using path.join("/app/ssh", readdir name) — shows hidden chars via nameJson. */
  sshDirEntries: Array<{ nameJson: string } & KeyPathInspect> | null
  candidates: Array<KeyPathInspect>
  firstReadablePath: string | null
} {
  let settingsKeyPath = ""
  try {
    settingsKeyPath = getSettings().proxmoxSshKeyPath?.trim() || ""
  } catch {
    settingsKeyPath = "(getSettings failed)"
  }
  const effectiveKeyPath =
    effective && typeof effective.proxmoxSshKeyPath === "string"
      ? effective.proxmoxSshKeyPath.trim()
      : ""
  const env = {
    PROXMOX_SSH_KEY_PATH: process.env.PROXMOX_SSH_KEY_PATH,
    GOAD_SSH_KEY_PATH: process.env.GOAD_SSH_KEY_PATH,
  }
  let sshDirListing: string[] | null = null
  let sshDirError: string | undefined
  let sshDirEntries: Array<{ nameJson: string } & KeyPathInspect> | null = null
  try {
    if (fs.existsSync("/app/ssh")) {
      const st = fs.statSync("/app/ssh")
      if (st.isDirectory()) {
        const names = fs.readdirSync("/app/ssh")
        sshDirListing = names
        sshDirEntries = names.map((name) => {
          const fullPath = path.join("/app/ssh", name)
          return { nameJson: JSON.stringify(name), ...inspectKeyPath(fullPath) }
        })
      } else {
        sshDirError = "/app/ssh exists but is not a directory"
      }
    } else {
      sshDirError = "/app/ssh does not exist (ssh volume not mounted?)"
    }
  } catch (e) {
    sshDirError = e instanceof Error ? e.message : String(e)
  }

  const uniq = [...new Set(getPrivateKeySearchPathsFor(effective ?? undefined))]
  const candidates = uniq.map((p) => inspectKeyPath(p))

  const firstReadablePath = candidates.find((c) => c.readable)?.path ?? null

  return {
    env,
    settingsKeyPath,
    effectiveKeyPath: effectiveKeyPath || undefined,
    sshDirListing,
    sshDirError,
    sshDirEntries,
    candidates,
    firstReadablePath,
  }
}

/**
 * If a key file exists on a configured path but the Node process cannot read it
 * (typical: root:root 600 on host, app runs as nextjs UID 1001), return a short hint.
 */
export function describePrivateKeyPermissionIssue(
  effective?: Pick<RuntimeSettings, "proxmoxSshKeyPath"> | null,
): string | null {
  for (const p of getPrivateKeySearchPathsFor(effective ?? undefined)) {
    const info = inspectKeyPath(p)
    if (info.danglingSymlink && info.readError) return info.readError
    if (!info.exists || !info.isFile) continue
    if (info.readable) return null
    const err = info.readError || ""
    if (/EACCES|EPERM|permission denied/i.test(err)) {
      return (
        `Private key exists at ${p} but is not readable by the app user (nextjs, UID 1001). ` +
        `Host files owned by root with mode 600 cannot be read inside the container. ` +
        `Fix: use a writable ssh volume (docker-compose no longer uses :ro) and restart so the entrypoint can chown the key, ` +
        `or on the host: chown 1001:1001 ssh/id_rsa from your ludus-ux directory.`
      )
    }
    if (err) return `Private key at ${p} could not be read: ${err}`
  }
  return null
}

/** Filesystem path of the first readable private key, or null. */
export function getResolvedPrivateKeyPath(
  effective?: Pick<RuntimeSettings, "proxmoxSshKeyPath"> | null,
): string | null {
  for (const p of getPrivateKeySearchPathsFor(effective ?? undefined)) {
    if (inspectKeyPath(p).readable) return p
  }
  const home = process.env.HOME || "/root"
  for (const name of ["id_rsa", "id_ed25519"]) {
    const kp = path.join(home, ".ssh", name)
    if (inspectKeyPath(kp).readable) return kp
  }
  return null
}

export function readPrivateKey(
  effective?: Pick<RuntimeSettings, "proxmoxSshKeyPath"> | null,
): Buffer | null {
  const p = getResolvedPrivateKeyPath(effective)
  if (!p) return null
  try {
    return normalizePrivateKeyBuffer(fs.readFileSync(p))
  } catch {
    return null
  }
}

export function getSshKeyPassphrase(): string | undefined {
  const p = (process.env.PROXMOX_SSH_KEY_PASSPHRASE || process.env.GOAD_SSH_KEY_PASSPHRASE || "").trim()
  return p || undefined
}

/** True if server-side SSH to root can run (password in settings/env or readable key). */
export function isRootProxmoxSshConfigured(
  settings: Pick<RuntimeSettings, "proxmoxSshPassword" | "proxmoxSshKeyPath">,
): boolean {
  if ((settings.proxmoxSshPassword || "").trim()) return true
  return !!readPrivateKey({ proxmoxSshKeyPath: settings.proxmoxSshKeyPath || "" })
}

/**
 * Proxmox REST / PAM login (used by in-browser noVNC). Not satisfied by SSH keys alone.
 */
export function hasProxmoxPamOrSessionPassword(
  settings: { proxmoxSshPassword: string },
  sessionPassword?: string | null,
): boolean {
  return !!(settings.proxmoxSshPassword || "").trim() || !!(sessionPassword || "").trim()
}

/** GOAD: pass only when a root password is configured; otherwise key auth is used. */
export function rootPasswordCredsIfSet(settings: {
  proxmoxSshUser: string
  proxmoxSshPassword: string
}): { username: string; password: string } | undefined {
  const pw = (settings.proxmoxSshPassword || "").trim()
  if (!pw) return undefined
  return { username: (settings.proxmoxSshUser || "root").trim() || "root", password: pw }
}

export function buildConnectAuthFromRootSettings(
  settings: Pick<RuntimeSettings, "proxmoxSshPassword" | "proxmoxSshKeyPath">,
): Pick<ConnectConfig, "password" | "privateKey" | "passphrase"> {
  const pw = (settings.proxmoxSshPassword || "").trim()
  if (pw) return { password: pw }
  const key = readPrivateKey({ proxmoxSshKeyPath: settings.proxmoxSshKeyPath || "" })
  if (!key) {
    throw new Error(
      "No root SSH authentication: set PROXMOX_SSH_PASSWORD or mount a private key (PROXMOX_SSH_KEY_PATH / ./ssh/id_rsa).",
    )
  }
  const ph = getSshKeyPassphrase()
  return { privateKey: key, ...(ph ? { passphrase: ph } : {}) }
}

/** For pvesh-over-SSH: settings password, session login password, or mounted root key. */
export function hasSshExecAuth(
  settings: Pick<RuntimeSettings, "proxmoxSshPassword" | "proxmoxSshKeyPath">,
  sessionPassword?: string | null,
): boolean {
  return isRootProxmoxSshConfigured(settings) || !!(sessionPassword || "").trim()
}
