/**
 * POST /api/templates/add
 *
 * Adds one or more templates from a remote source to the connected Ludus server.
 *
 * Workflow:
 *  1. Recursively list ALL files under the template path (blobs only, all
 *     subdirs included via recursive=true + pagination).
 *  2. Fetch each file's raw content from the remote repository.
 *  3. Discover the Ludus packer templates directory on the server.
 *  4. Create the full directory tree on the server (iso/, ansible/, etc.).
 *  5. Write each file preserving its relative path within the template.
 *  6. Fix ownership/permissions to ludus:ludus 755.
 *  7. Register the template with `ludus templates add -d <destDir>` as the
 *     logged-in Ludus user (the Ludus ROOT API key or host SSH alone is not
 *     sufficient).
 *
 * Request body:
 *   {
 *     templates: {
 *       name: string;          // Packer vm_name registered with Ludus
 *       path: string;          // repo path; last segment is the on-disk directory (e.g. templates/debian13)
 *       apiBase: string;       // GitLab or GitHub repository API base URL
 *       ref:     string;       // git ref (branch/tag/sha)
 *     }[]
 *   }
 *
 * Response:
 *   { results: { name: string; success: boolean; message: string }[] }
 */

import { NextRequest, NextResponse } from "next/server"
import { effectiveScopeTagFromSession } from "@/lib/effective-scope"
import { logLuxRouteAction } from "@/lib/lux-api-audit"
import { revalidateLudusResource, revalidateLudusScopeResource } from "@/lib/ludus-cache-revalidate"
import {
  ensureGitSource,
  installSourceTemplates,
  isHttp404Error,
} from "@/lib/ludus-source-client"
import { logAndSafeError } from "@/lib/safe-client-error"
import { sshExec } from "@/lib/goad-ssh"
import { resolveAdminImpersonationFromRequest } from "@/lib/admin-impersonation-request"
import { resolveSession } from "@/lib/session"
import { assertSafeTemplateRepoUrl } from "@/lib/safe-template-repo-url"
import { apiBaseToGitUrl, fetchAllRepoBlobs, fetchRepoRawFile } from "@/lib/template-repo-client"
import { combineTemplateFailure } from "@/lib/template-add-errors"
import { resolveLudusInstallPath } from "@/lib/runtime-paths"
import {
  buildLudusTemplateAddCmd,
  derivePackerRootFromPkrPath,
  isLudusCliTemplateAddFailure,
  isLudusTemplateAlreadyRegistered,
  packerRootCandidates,
  shellSingleQuote,
} from "@/lib/template-packer-paths"
import { packerDirFromTemplatePath, templateBlobRelativePath } from "@/lib/packer-vm-name"
import { resolveGitTemplateInstallName } from "@/lib/source-git-catalog"
import { writeRemoteFileViaSsh } from "@/lib/template-remote-write"


interface TemplateSpec {
  name:    string
  path:    string
  apiBase: string
  ref:     string
}

interface TemplateAddContext {
  ludusApiKey: string
  linuxUser: string
}

let cachedTemplatesDir: { root: string; dir: string } | null = null

async function findTemplatesDir(): Promise<string> {
  const ludusRoot = resolveLudusInstallPath()
  if (cachedTemplatesDir?.root === ludusRoot) return cachedTemplatesDir.dir

  // Prefer built-in packer tree; never treat Ludus Sources mirrors as install targets.
  const findResult = await sshExec(["find-packer"])
  const firstPath = (findResult.stdout || "").trim().split("\n")[0]?.trim()
  if (firstPath) {
    const dir = derivePackerRootFromPkrPath(firstPath)
    if (dir) {
      cachedTemplatesDir = { root: ludusRoot, dir }
      return dir
    }
  }

  for (const candidate of packerRootCandidates(ludusRoot)) {
    const check = await sshExec(["dir-exists", candidate]).catch(() => ({ stdout: "", stderr: "", code: 1 }))
    if ((check.stdout || "").trim() === "ok") {
      cachedTemplatesDir = { root: ludusRoot, dir: candidate }
      return candidate
    }
  }

  const fallback = `${ludusRoot}/packer`
  cachedTemplatesDir = { root: ludusRoot, dir: fallback }
  return fallback
}


async function addTemplate(
  spec: TemplateSpec,
  ctx: TemplateAddContext,
): Promise<{ success: boolean; message: string }> {
  const { name, path: templatePath, apiBase, ref } = spec

  const dirName = packerDirFromTemplatePath(templatePath, name)
  if (!dirName) {
    throw new Error(
      `Invalid template directory in "${templatePath}". Use a single directory name of letters, numbers, hyphens, underscores, and dots.`,
    )
  }

  const safe = assertSafeTemplateRepoUrl(apiBase)
  if (!safe.ok) {
    throw new Error(safe.error)
  }
  const safeApiBase = safe.apiBase

  const blobs = await fetchAllRepoBlobs(safeApiBase, templatePath, ref)

  if (blobs.length === 0) {
    throw new Error(`No files found in ${templatePath}`)
  }

  const prefix = templatePath.endsWith("/") ? templatePath : templatePath + "/"
  const files: { relativePath: string; content: Buffer }[] = []
  for (const blob of blobs) {
    const relativePath = templateBlobRelativePath(blob.path, blob.name, prefix)
    if (!relativePath) {
      throw new Error(
        `Invalid template file path "${blob.path}". Each file must stay inside the template directory.`,
      )
    }
    const content = await fetchRepoRawFile(safeApiBase, blob.path, ref)
    files.push({ relativePath, content: Buffer.from(content) })
  }

  let templatesDir: string
  try {
    templatesDir = await findTemplatesDir()
  } catch (err) {
    const msg = logAndSafeError("templates/add", err, "Template add failed")
    if (/all configured authentication methods failed/i.test(msg) || /authentication/i.test(msg)) {
      throw new Error(
        "Host SSH authentication failed. To add templates, configure host SSH: " +
        "set PROXMOX_SSH_PASSWORD (or mount a private key for PROXMOX_SSH_USER: ./ssh → /app/ssh, PROXMOX_SSH_KEY_PATH) " +
        "in your .env or Settings → SSH. The account can be root, or another user that can run sudo -n /usr/local/sbin/lux-host."
      )
    }
    throw err
  }

  const destDir = `${templatesDir}/${dirName}`

  const subdirs = new Set<string>()
  subdirs.add(destDir)
  for (const file of files) {
    const parts = file.relativePath.split("/").slice(0, -1)
    if (parts.length > 0) {
      subdirs.add(`${destDir}/${parts.join("/")}`)
    }
  }
  const mkdirResult = await sshExec(["mkdir", ...subdirs])
  if (mkdirResult.code !== 0) {
    throw new Error(`Failed to create template dirs under ${destDir}: ${mkdirResult.stderr}`)
  }

  for (const file of files) {
    const destPath = `${destDir}/${file.relativePath}`
    try {
      await writeRemoteFileViaSsh(destPath, file.content)
    } catch (err) {
      await sshExec(["rm-tree", destDir]).catch(() => {})
      throw new Error(`Failed to write ${file.relativePath}: ${(err as Error).message}`)
    }
  }

  await sshExec(["chown-ludus", destDir]).catch(() => {
    // Non-fatal if the ludus user doesn't exist under that name.
  })

  const addCmd = buildLudusTemplateAddCmd(destDir, ctx.ludusApiKey)
  const addResult = await sshExec(addCmd)
  const rawMsg = (addResult.stdout + addResult.stderr).trim()

  if (isLudusCliTemplateAddFailure(rawMsg, addResult.code)) {
    throw new Error(
      `ludus templates add failed (exit ${addResult.code}).\n` +
      `Output: ${rawMsg || "(none)"}\n` +
      `Template files are on disk at: ${destDir}`
    )
  }

  if (isLudusTemplateAlreadyRegistered(rawMsg)) {
    return { success: true, message: `Template "${name}" is already registered` }
  }

  return { success: true, message: `Template "${name}" added successfully` }
}

async function tryInstallTemplatesViaSources(
  apiKey: string,
  specs: TemplateSpec[],
): Promise<Map<string, { success: boolean; message: string }>> {
  const out = new Map<string, { success: boolean; message: string }>()
  if (specs.length === 0) return out

  const gitUrl = apiBaseToGitUrl(specs[0].apiBase)
  if (!gitUrl) return out

  try {
    const sourceID = await ensureGitSource(apiKey, gitUrl, specs[0].ref || "main")
    const names = specs.map((s) => s.name)
    const { warnings, data } = await installSourceTemplates(apiKey, sourceID, names)

    for (const t of data?.templateResults ?? []) {
      if (!t.name) continue
      if (t.ok === true) {
        out.set(t.name, {
          success: true,
          message: t.message || `Template "${t.name}" installed from Ludus source`,
        })
      } else if (t.ok === false) {
        out.set(t.name, {
          success: false,
          message: t.message || `Template "${t.name}" failed via Ludus Sources`,
        })
      }
    }
    for (const w of warnings) {
      const m = /Template ([^:]+):/.exec(w)
      if (m?.[1] && !out.has(m[1])) {
        out.set(m[1], {
          success: false,
          message: w,
        })
      }
    }
  } catch (err) {
    if (!isHttp404Error(err)) {
      const msg = err instanceof Error ? err.message : String(err)
      for (const spec of specs) {
        if (!out.has(spec.name)) {
          out.set(spec.name, { success: false, message: `Ludus Sources error: ${msg}` })
        }
      }
    }
  }

  return out
}

/** Sources install uses Packer `vm_name`; the git path stays the short folder. */
async function resolveTemplateSpecName(spec: TemplateSpec): Promise<TemplateSpec> {
  const dir = packerDirFromTemplatePath(spec.path || "", spec.name)
  if (!dir) {
    throw new Error(
      `Invalid template directory in "${spec.path}". Use a single directory name of letters, numbers, hyphens, underscores, and dots.`,
    )
  }
  if (spec.name !== dir && /-template$/i.test(spec.name)) return spec
  const safe = assertSafeTemplateRepoUrl(spec.apiBase)
  if (!safe.ok) return spec
  const name = await resolveGitTemplateInstallName(
    safe.apiBase,
    spec.ref || "main",
    dir,
    undefined,
    spec.path,
  )
  if (!name || name === spec.name) return spec
  return { ...spec, name }
}

function resolveTemplateAddContext(
  session: NonNullable<Awaited<ReturnType<typeof resolveSession>>>,
  request: NextRequest,
): TemplateAddContext {
  const imp = resolveAdminImpersonationFromRequest(session, request)
  const ludusApiKey = (imp.apiKey || session.apiKey || "").trim()
  const linuxUser = (imp.sshLogin || imp.ludusPrincipal || session.username || "").trim().toLowerCase()
  if (!ludusApiKey) {
    throw new Error("No Ludus API key in session — sign in again.")
  }
  if (!linuxUser) {
    throw new Error("Could not resolve Linux username for template registration.")
  }
  return { ludusApiKey, linuxUser }
}

export async function POST(request: NextRequest) {
  const session = await resolveSession(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  if (!session.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }

  let addCtx: TemplateAddContext
  try {
    addCtx = resolveTemplateAddContext(session, request)
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 },
    )
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

  const NAME_RE = /^[a-zA-Z0-9._-]{1,120}$/
  for (const spec of templates) {
    if (!NAME_RE.test(spec.name ?? "")) {
      return NextResponse.json(
        { error: `Invalid template name "${spec.name}". Use only letters, numbers, hyphens, underscores, and dots.` },
        { status: 400 },
      )
    }
    if (!packerDirFromTemplatePath(spec.path ?? "", spec.name)) {
      return NextResponse.json(
        { error: `Invalid template path "${spec.path ?? ""}". Use a single directory name of letters, numbers, hyphens, underscores, and dots.` },
        { status: 400 },
      )
    }
  }

  const resolvedTemplates = await Promise.all(templates.map((spec) => resolveTemplateSpecName(spec)))

  const byRepo = new Map<string, TemplateSpec[]>()
  for (const spec of resolvedTemplates) {
    const key = `${spec.apiBase}|${spec.ref || "main"}`
    const group = byRepo.get(key) ?? []
    group.push(spec)
    byRepo.set(key, group)
  }

  const sourceResults = new Map<string, { success: boolean; message: string }>()
  for (const group of byRepo.values()) {
    const batch = await tryInstallTemplatesViaSources(addCtx.ludusApiKey, group)
    for (const [name, result] of batch) sourceResults.set(name, result)
  }

  const mapped = await Promise.all(
    resolvedTemplates.map(async (spec) => {
      const fromSource = sourceResults.get(spec.name)
      if (fromSource?.success) {
        return { name: spec.name, ...fromSource }
      }
      const sourcesFailure = fromSource && !fromSource.success ? fromSource.message : undefined
      return addTemplate(spec, addCtx)
        .then((r) => ({ name: spec.name, ...r }))
        .catch((e) => ({
          name: spec.name,
          success: false,
          message: combineTemplateFailure((e as Error).message, sourcesFailure),
        }))
    }),
  )

  const anyOk = mapped.some((r) => r.success)
  if (anyOk) {
    const scopeTag = effectiveScopeTagFromSession(session)
    revalidateLudusResource("templates")
    revalidateLudusScopeResource(scopeTag, "templates")
  }
  const allOk = mapped.every((r) => r.success)
  logLuxRouteAction(request, session, {
    outcome: allOk ? "success" : "failure",
    detail: `templates=${resolvedTemplates.map((t) => t.name).join(",")}`,
  })
  return NextResponse.json({ results: mapped })
}
