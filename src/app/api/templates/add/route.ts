/**
 * POST /api/templates/add
 *
 * Adds one or more templates from a remote source to the connected Ludus server.
 *
 * Workflow:
 *  1. Recursively list ALL files under the template path (blobs only, all
 *     subdirs included via recursive=true + pagination).
 *  2. Fetch each file's raw content from GitLab.
 *  3. Discover the Ludus packer templates directory on the server.
 *  4. Create the full directory tree on the server (iso/, ansible/, etc.).
 *  5. Write each file preserving its relative path within the template.
 *  6. Fix ownership/permissions to ludus:ludus 755.
 *  7. Register the template with `ludus templates add -d <destDir>`.
 *
 * Request body:
 *   {
 *     templates: {
 *       name: string;          // directory name, used as the template sub-dir
 *       path: string;          // relative path in the repo, e.g. "templates/debian10"
 *       apiBase: string;       // GitLab repository API base URL
 *       ref:     string;       // git ref (branch/tag/sha)
 *     }[]
 *   }
 *
 * Response:
 *   { results: { name: string; success: boolean; message: string }[] }
 */

import { NextRequest, NextResponse } from "next/server"
import { sshExec } from "@/lib/goad-ssh"
import { getSessionFromRequest } from "@/lib/session"

export const dynamic = "force-dynamic"

interface TemplateSpec {
  name:    string
  path:    string
  apiBase: string
  ref:     string
}

interface GitLabTreeItem {
  name: string
  type: "tree" | "blob"
  path: string
}

async function fetchRaw(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": "ludus-ux/1.0" } })
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
  return res.text()
}

/** ──────────────────────────────────────────────────────────────────────────
 *  Discover the Ludus packer templates directory on the server.
 *
 *  Strategy (in order):
 *    1. Find where an existing *.pkr.hcl template file lives and derive the
 *       parent-of-parent dir (i.e. the top-level templates folder).
 *    2. Fall back to the standard Ludus installation paths.
 * ──────────────────────────────────────────────────────────────────────────*/
let cachedTemplatesDir: string | null = null

async function findTemplatesDir(): Promise<string> {
  if (cachedTemplatesDir) return cachedTemplatesDir

  // Try to locate an existing .pkr.hcl file and derive the templates root
  const findResult = await sshExec(
    "find /opt/ludus /root/.config/ludus /home -maxdepth 10 -name '*.pkr.hcl' 2>/dev/null | head -3"
  )
  const found = (findResult.stdout || "").trim()
  if (found) {
    // Each line is a path like /opt/ludus/packer/templates/debian12/debian12.pkr.hcl
    // Walk up two levels to get the templates root (/opt/ludus/packer/templates)
    const firstPath = found.split("\n")[0].trim()
    const dir = firstPath.split("/").slice(0, -2).join("/")
    if (dir) {
      cachedTemplatesDir = dir
      return dir
    }
  }

  // Standard Ludus v2 installation paths to try in order
  const candidates = [
    "/opt/ludus/packer/templates",
    "/opt/ludus/templates",
    "/opt/ludus/packer-templates",
    "/root/.config/ludus/packer/templates",
  ]
  for (const candidate of candidates) {
    const check = await sshExec(`test -d '${candidate}' && echo ok`)
    if ((check.stdout || "").trim() === "ok") {
      cachedTemplatesDir = candidate
      return candidate
    }
  }

  // Last resort: use /opt/ludus (Ludus CLI should still find files under here)
  cachedTemplatesDir = "/opt/ludus/packer/templates"
  return cachedTemplatesDir
}

/** Collect ALL blobs under a GitLab path recursively, handling pagination. */
async function fetchAllBlobs(apiBase: string, path: string, ref: string): Promise<GitLabTreeItem[]> {
  const blobs: GitLabTreeItem[] = []
  let page = 1
  while (true) {
    const url = `${apiBase}/tree?path=${encodeURIComponent(path)}&ref=${ref}&per_page=100&recursive=true&page=${page}`
    const res = await fetch(url, { headers: { "User-Agent": "ludus-ux/1.0" } })
    if (!res.ok) throw new Error(`Could not list template tree (HTTP ${res.status})`)
    const items = (await res.json()) as GitLabTreeItem[]
    blobs.push(...items.filter((i) => i.type === "blob"))
    if (items.length < 100) break  // reached the last page
    page++
  }
  return blobs
}

async function addTemplate(spec: TemplateSpec): Promise<{ success: boolean; message: string }> {
  const { name, path: templatePath, apiBase, ref } = spec

  // ── Step 1: Recursively list ALL files in the template directory ──────────
  // Using recursive=true ensures subdirs like iso/, ansible/, scripts/ are included.
  const blobs = await fetchAllBlobs(apiBase, templatePath, ref)

  if (blobs.length === 0) {
    throw new Error(`No files found in ${templatePath}`)
  }

  // ── Step 2: Fetch every file's content, preserving relative paths ─────────
  // blob.path = "templates/win2019-server-x64/ansible/tasks/main.yml"
  // relativePath = "ansible/tasks/main.yml"  (strip the templatePath prefix)
  const prefix = templatePath.endsWith("/") ? templatePath : templatePath + "/"
  const files: { relativePath: string; b64: string }[] = []
  for (const blob of blobs) {
    const relativePath = blob.path.startsWith(prefix)
      ? blob.path.slice(prefix.length)
      : blob.name
    const rawUrl = `${apiBase}/files/${encodeURIComponent(blob.path)}/raw?ref=${ref}`
    const content = await fetchRaw(rawUrl)
    files.push({ relativePath, b64: Buffer.from(content).toString("base64") })
  }

  // ── Step 3: Discover the server's templates directory ────────────────────
  let templatesDir: string
  try {
    templatesDir = await findTemplatesDir()
  } catch (err) {
    const msg = (err as Error).message
    if (/all configured authentication methods failed/i.test(msg) || /authentication/i.test(msg)) {
      throw new Error(
        "Root SSH authentication failed. To add templates, configure root SSH access: " +
        "set PROXMOX_SSH_PASSWORD (or mount a root private key: ./ssh → /app/ssh, PROXMOX_SSH_KEY_PATH) " +
        "in your .env or Settings → SSH."
      )
    }
    throw err
  }

  // ── Step 4: Create the destination directory tree on the server ───────────
  const destDir = `${templatesDir}/${name}`

  // Collect all unique sub-directories needed and create them in a single call
  const subdirs = new Set<string>()
  subdirs.add(destDir)
  for (const file of files) {
    const parts = file.relativePath.split("/").slice(0, -1)
    if (parts.length > 0) {
      // Add every ancestor dir (mkdir -p handles this, but we still need the leaf)
      subdirs.add(`${destDir}/${parts.join("/")}`)
    }
  }
  const mkdirCmd = Array.from(subdirs).map((d) => `'${d}'`).join(" ")
  const mkdirResult = await sshExec(`mkdir -p ${mkdirCmd}`)
  if (mkdirResult.code !== 0) {
    throw new Error(`Failed to create template dirs under ${destDir}: ${mkdirResult.stderr}`)
  }

  // ── Step 5: Write each file to its correct relative path ─────────────────
  for (const file of files) {
    const destPath = `${destDir}/${file.relativePath}`
    const cmd = `printf '%s' '${file.b64.replace(/'/g, "'\\''")}' | base64 -d > '${destPath}'`
    const writeResult = await sshExec(cmd)
    if (writeResult.code !== 0) {
      await sshExec(`rm -rf '${destDir}'`).catch(() => {})
      throw new Error(`Failed to write ${file.relativePath}: ${writeResult.stderr}`)
    }
  }

  // ── Step 6: Fix ownership + permissions ──────────────────────────────────
  // Files are written as root; the ludus service user needs read access.
  // Existing templates are ludus:ludus 755 — match that.
  await sshExec(`chown -R ludus:ludus '${destDir}' && chmod -R 755 '${destDir}'`).catch(() => {
    // Non-fatal if the ludus user doesn't exist under that name.
  })

  // ── Step 7: Register the template with the Ludus CLI ─────────────────────
  // `ludus templates add -d <dir>` registers the template in PocketBase.
  // The command prints [ERROR] lines when it tries to LIST templates afterwards
  // (root's Ludus CLI lacks list permissions), but the registration itself
  // succeeds — exit code 0 is the reliable success indicator.
  const addResult = await sshExec(`ludus templates add -d '${destDir}' 2>&1`)

  if (addResult.code !== 0) {
    const rawMsg = (addResult.stdout + addResult.stderr).trim()
    throw new Error(
      `ludus templates add failed (exit ${addResult.code}).\n` +
      `Output: ${rawMsg || "(none)"}\n` +
      `Template files are on disk at: ${destDir}`
    )
  }

  return { success: true, message: `Template "${name}" added successfully` }
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  if (!session.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }

  let body: { templates: TemplateSpec[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const { templates } = body
  if (!Array.isArray(templates) || templates.length === 0) {
    return NextResponse.json({ error: "No templates specified" }, { status: 400 })
  }

  // Sanitize template names to prevent path traversal / shell injection via destDir.
  // Names must be alphanumeric with dashes, underscores, or dots only.
  const NAME_RE = /^[a-zA-Z0-9._-]{1,120}$/
  for (const spec of templates) {
    if (!NAME_RE.test(spec.name ?? "")) {
      return NextResponse.json(
        { error: `Invalid template name "${spec.name}". Use only letters, numbers, hyphens, underscores, and dots.` },
        { status: 400 },
      )
    }
  }

  const results = await Promise.allSettled(
    templates.map((spec) =>
      addTemplate(spec)
        .then((r)  => ({ name: spec.name, ...r }))
        .catch((e) => ({ name: spec.name, success: false, message: (e as Error).message }))
    )
  )

  return NextResponse.json({
    results: results.map((r) => (r.status === "fulfilled" ? r.value : { name: "?", success: false, message: String(r.reason) })),
  })
}
