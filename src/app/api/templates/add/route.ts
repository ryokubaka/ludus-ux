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
 *     logged-in Ludus user (ROOT key / root SSH alone is not sufficient).
 *
 * Request body:
 *   {
 *     templates: {
 *       name: string;          // directory name, used as the template sub-dir
 *       path: string;          // relative path in the repo, e.g. "templates/debian10"
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
  const findResult = await sshExec(
    `find ${shellSingleQuote(`${ludusRoot}/packer`)} -maxdepth 3 -name '*.pkr.hcl' ! -path '*/sources/*' 2>/dev/null | head -1`,
  )
  const firstPath = (findResult.stdout || "").trim().split("\n")[0]?.trim()
  if (firstPath) {
    const dir = derivePackerRootFromPkrPath(firstPath)
    if (dir) {
      cachedTemplatesDir = { root: ludusRoot, dir }
      return dir
    }
  }

  for (const candidate of packerRootCandidates(ludusRoot)) {
    const check = await sshExec(`test -d ${shellSingleQuote(candidate)} && echo ok`)
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
    const relativePath = blob.path.startsWith(prefix)
      ? blob.path.slice(prefix.length)
      : blob.name
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
        "Root SSH authentication failed. To add templates, configure root SSH access: " +
        "set PROXMOX_SSH_PASSWORD (or mount a root private key: ./ssh → /app/ssh, PROXMOX_SSH_KEY_PATH) " +
        "in your .env or Settings → SSH."
      )
    }
    throw err
  }

  const destDir = `${templatesDir}/${name}`

  const subdirs = new Set<string>()
  subdirs.add(destDir)
  for (const file of files) {
    const parts = file.relativePath.split("/").slice(0, -1)
    if (parts.length > 0) {
      subdirs.add(`${destDir}/${parts.join("/")}`)
    }
  }
  const mkdirCmd = Array.from(subdirs).map((d) => `'${d}'`).join(" ")
  const mkdirResult = await sshExec(`mkdir -p ${mkdirCmd}`)
  if (mkdirResult.code !== 0) {
    throw new Error(`Failed to create template dirs under ${destDir}: ${mkdirResult.stderr}`)
  }

  for (const file of files) {
    const destPath = `${destDir}/${file.relativePath}`
    try {
      await writeRemoteFileViaSsh(destPath, file.content)
    } catch (err) {
      await sshExec(`rm -rf '${destDir}'`).catch(() => {})
      throw new Error(`Failed to write ${file.relativePath}: ${(err as Error).message}`)
    }
  }

  await sshExec(`chown -R ludus:ludus '${destDir}' && chmod -R 755 '${destDir}'`).catch(() => {
    // Non-fatal if the ludus user doesn't exist under that name.
  })

  const addCmd = buildLudusTemplateAddCmd(destDir, ctx.linuxUser, ctx.ludusApiKey)
  const addResult = await sshExec(`${addCmd} 2>&1`)
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
  }

  const byRepo = new Map<string, TemplateSpec[]>()
  for (const spec of templates) {
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
    templates.map(async (spec) => {
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
    detail: `templates=${templates.map((t) => t.name).join(",")}`,
  })
  return NextResponse.json({ results: mapped })
}
