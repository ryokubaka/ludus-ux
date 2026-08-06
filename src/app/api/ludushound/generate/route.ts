import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { resolveLudushoundSession } from "@/lib/ludushound-session"
import {
  buildLudushoundBinary,
  ensureLudushoundWorkspace,
  probeLudushoundHost,
  readRemoteTextFile,
  runLudushoundGenerate,
  writeLudushoundRangeId,
  writeRemoteTextFile,
} from "@/lib/ludushound-ssh"
import {
  buildLudushoundRequiredTemplates,
  auditTemplates,
} from "@/lib/ludushound-templates"
import { assertLudushoundTemplatesReady } from "@/lib/ludushound-template-assert"
import {
  validateLudushoundArgs,
  type LudushoundGenerateArgs,
  DEFAULT_NEO4J_PASS,
  DEFAULT_NEO4J_USER,
} from "@/lib/ludushound-wizard-args"
import { resolveLudushoundPath } from "@/lib/runtime-paths"
import { logLuxRouteAction } from "@/lib/lux-api-audit"
import { ludusRequest } from "@/lib/ludus-client"

type GenerateBody = {
  mode: "full" | "attackpath"
  workspaceId?: string
  rangeId?: string
  localRoles?: boolean
  /** full + neo4j */
  bloodhoundSource?: "external" | "filesmap"
  server?: string
  user?: string
  pass?: string
  aliveComputers?: string[]
  /** filesmap JSON text uploaded from browser */
  filesMapJsonContent?: string
  /** attackpath */
  attackPathContent?: string
  domainController?: string
}

export async function POST(request: NextRequest) {
  const ctx = await resolveLudushoundSession(request)
  if (!ctx) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as GenerateBody | null
  if (!body || !body.mode) {
    return NextResponse.json({ error: "mode is required" }, { status: 400 })
  }

  const probe = await probeLudushoundHost(ctx.creds)
  if (!probe.repoPresent) {
    return NextResponse.json(
      { error: `Clone LudusHound to ${probe.ludushoundPath} first.` },
      { status: 400 },
    )
  }
  if (!probe.binaryPresent) {
    const built = await buildLudushoundBinary(undefined)
    if (!built.ok) {
      return NextResponse.json({ error: built.error || "Failed to build LudusHound" }, { status: 500 })
    }
  }

  const workspaceId = (body.workspaceId || `lh-${randomUUID().slice(0, 8)}`).replace(
    /[^a-zA-Z0-9._-]/g,
    "",
  )
  const wsDir = await ensureLudushoundWorkspace(workspaceId, ctx.creds)
  if (body.rangeId?.trim()) {
    await writeLudushoundRangeId(workspaceId, body.rangeId.trim(), ctx.creds)
  }

  const output = `${wsDir}/out/LudusHound.yml`
  const root = resolveLudushoundPath()
  let args: LudushoundGenerateArgs

  if (body.mode === "attackpath") {
    if (!body.attackPathContent?.trim() || !body.domainController?.trim()) {
      return NextResponse.json(
        { error: "attackPathContent and domainController are required" },
        { status: 400 },
      )
    }
    const attackPath = `${wsDir}/uploads/attackpath.json`
    await writeRemoteTextFile(attackPath, body.attackPathContent, ctx.creds)
    args = {
      mode: "attackpath",
      attackPath,
      domainController: body.domainController.trim(),
      output,
      localRoles: !!body.localRoles,
    }
  } else if (body.bloodhoundSource === "filesmap") {
    if (!body.filesMapJsonContent?.trim() || !body.aliveComputers?.length) {
      return NextResponse.json(
        { error: "filesMapJsonContent and aliveComputers are required" },
        { status: 400 },
      )
    }
    const filesMapJson = `${wsDir}/uploads/filesMap.json`
    await writeRemoteTextFile(filesMapJson, body.filesMapJsonContent, ctx.creds)
    args = {
      mode: "full",
      source: "filesmap",
      filesMapJson,
      aliveComputers: body.aliveComputers,
      output,
      localRoles: !!body.localRoles,
    }
  } else {
    if (!body.aliveComputers?.length) {
      return NextResponse.json({ error: "aliveComputers is required" }, { status: 400 })
    }
    args = {
      mode: "full",
      source: "external",
      server: (body.server || "").trim(),
      user: (body.user || DEFAULT_NEO4J_USER).trim(),
      pass: body.pass ?? DEFAULT_NEO4J_PASS,
      aliveComputers: body.aliveComputers,
      output,
      localRoles: !!body.localRoles,
    }
  }

  const validation = validateLudushoundArgs(args)
  if (validation) {
    return NextResponse.json({ error: validation }, { status: 400 })
  }

  const result = await runLudushoundGenerate(args, ctx.creds)
  if (!result.ok) {
    logLuxRouteAction(request, ctx.session, { outcome: "failure", detail: "generate failed" })
    return NextResponse.json(
      {
        error: "LudusHound generate failed",
        stdout: result.stdout,
        stderr: result.stderr,
        code: result.code,
        workspaceId,
      },
      { status: 500 },
    )
  }

  const yamlText = await readRemoteTextFile(output, ctx.creds)
  if (!yamlText.trim()) {
    return NextResponse.json(
      { error: "LudusHound produced an empty YAML file", stdout: result.stdout, workspaceId },
      { status: 500 },
    )
  }

  const tplAssert = await assertLudushoundTemplatesReady(ctx.apiKey, {
    yamlText,
  })

  // Also return inventory-based audit even when not ready (client can show chips)
  let templateAudit = tplAssert.summary
  if (!tplAssert.ok) {
    const req = buildLudushoundRequiredTemplates({ yamlText })
    templateAudit = tplAssert.summary.required.length
      ? tplAssert.summary
      : auditTemplates(req.required, [], [])
  }

  logLuxRouteAction(request, ctx.session)
  return NextResponse.json({
    ok: true,
    workspaceId,
    outputPath: output,
    ludushoundPath: root,
    yaml: yamlText,
    stdout: result.stdout,
    stderr: result.stderr,
    templatesReady: tplAssert.ok,
    templateAudit,
    templatesError: tplAssert.ok ? undefined : tplAssert.error,
  })
}

/** Optional: fetch templates inventory for client-side chips without generate. */
export async function GET(request: NextRequest) {
  const ctx = await resolveLudushoundSession(request)
  if (!ctx) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  const tplRes = await ludusRequest("/templates", {
    method: "GET",
    apiKey: ctx.apiKey,
    timeout: 60_000,
  })
  if (tplRes.error) {
    return NextResponse.json({ error: tplRes.error }, { status: 502 })
  }
  return NextResponse.json({ templates: tplRes.data })
}
