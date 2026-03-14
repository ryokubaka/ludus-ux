/**
 * POST /api/templates/add
 *
 * Adds one or more templates from a remote source to the connected Ludus server.
 *
 * Workflow:
 *  1. Fetch each template's files from the source (GitLab raw API) on the
 *     Next.js server (no CORS issues, no internet requirement on the Ludus box).
 *  2. Write the files to a temp directory on the Ludus server via root SSH
 *     (base64-encoded to avoid shell-quoting issues with arbitrary file content).
 *  3. Run `ludus templates add -d <tmpdir>` on the server to register the
 *     template with the Ludus API.
 *  4. Clean up the temp directory.
 *
 * Request body:
 *   {
 *     templates: {
 *       name: string;          // directory name, used as the temp dir name
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

async function addTemplate(spec: TemplateSpec): Promise<{ success: boolean; message: string }> {
  const { name, path: templatePath, apiBase, ref } = spec
  const tmpDir = `/tmp/ludus-template-add-${name}-${Date.now()}`

  // 1. List files in the template directory from the source
  const treeUrl  = `${apiBase}/tree?path=${encodeURIComponent(templatePath)}&ref=${ref}&per_page=100`
  const treeRes  = await fetch(treeUrl, { headers: { "User-Agent": "ludus-ux/1.0" } })
  if (!treeRes.ok) throw new Error(`Could not list template files (HTTP ${treeRes.status})`)
  const treeData = (await treeRes.json()) as GitLabTreeItem[]
  const blobs    = treeData.filter((i) => i.type === "blob")

  if (blobs.length === 0) {
    throw new Error(`No files found in ${templatePath}`)
  }

  // 2. Fetch each file's content
  const files: { name: string; b64: string }[] = []
  for (const blob of blobs) {
    const rawUrl = `${apiBase}/files/${encodeURIComponent(blob.path)}/raw?ref=${ref}`
    const content = await fetchRaw(rawUrl)
    files.push({ name: blob.name, b64: Buffer.from(content).toString("base64") })
  }

  // 3. Write files to the Ludus server via root SSH
  //    a. Create temp dir
  let mkdirResult
  try {
    mkdirResult = await sshExec(`rm -rf '${tmpDir}' && mkdir -p '${tmpDir}'`)
  } catch (err) {
    const msg = (err as Error).message
    if (/all configured authentication methods failed/i.test(msg) || /authentication/i.test(msg)) {
      throw new Error(
        "Root SSH authentication failed. To add templates, configure root SSH access: " +
        "set PROXMOX_SSH_PASSWORD in your .env file (or configure it in Settings → SSH). " +
        "Alternatively, mount an SSH private key to /app/ssh/id_rsa in the container."
      )
    }
    throw err
  }
  if (mkdirResult.code !== 0) {
    throw new Error(`Failed to create temp dir on server: ${mkdirResult.stderr}`)
  }

  //    b. Write each file (base64-decode on the server to handle arbitrary content)
  for (const file of files) {
    // Split into 60-char base64 lines to avoid ARG_MAX limits on very large files
    const cmd = `printf '%s' '${file.b64.replace(/'/g, "'\\''")}' | base64 -d > '${tmpDir}/${file.name}'`
    const writeResult = await sshExec(cmd)
    if (writeResult.code !== 0) {
      await sshExec(`rm -rf '${tmpDir}'`).catch(() => {})
      throw new Error(`Failed to write ${file.name}: ${writeResult.stderr}`)
    }
  }

  // 4. Add the template via the Ludus CLI
  //    The CLI uses the root user's configured API key and server URL.
  const addResult = await sshExec(`ludus templates add -d '${tmpDir}' 2>&1`)
  const msg       = (addResult.stdout + addResult.stderr).trim()

  // 5. Clean up regardless of outcome
  await sshExec(`rm -rf '${tmpDir}'`).catch(() => {})

  if (addResult.code !== 0) {
    throw new Error(msg || `ludus templates add exited with code ${addResult.code}`)
  }

  return { success: true, message: msg || "Template added successfully" }
}

export async function POST(request: NextRequest) {
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
