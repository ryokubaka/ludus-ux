/**
 * POST /api/goad/instances/[instanceId]/enable-extension
 *
 * Append extension name to workspace instance.json so provide regenerates
 * inventories. Install Extension: enable → (provide if needed) → provision.
 * Prefer separate REPL sessions — GOAD often exits 0 after provide failure.
 */

import { NextRequest, NextResponse } from "next/server"
import { resolveSession } from "@/lib/session"
import { sshExec, isGoadConfigured, workspaceSshExecPlan } from "@/lib/goad-ssh"
import { rootPasswordCredsIfSet } from "@/lib/root-ssh-auth"
import { getSettings } from "@/lib/settings-store"
import { resolveGoadPath } from "@/lib/runtime-paths"
import { logLuxRouteAction } from "@/lib/lux-api-audit"

const ENABLE_EXT_PY = `
import json, os, sys, base64

def _b(i):
    return base64.b64decode(sys.argv[i]).decode("utf-8")

goad_path, instance_id, ext = _b(1), _b(2), _b(3)
ws = os.path.join(goad_path, "workspace", instance_id)
inst = os.path.join(ws, "instance.json")
errors = []
added = False
already = False

try:
    with open(inst, "r", encoding="utf-8") as fh:
        d = json.load(fh)
    ex = list(d.get("extensions") or [])
    if ext in ex:
        already = True
    else:
        ex.append(ext)
        d["extensions"] = ex
        with open(inst, "w", encoding="utf-8") as fh:
            json.dump(d, fh, indent=2)
        added = True
except Exception as e:
    errors.append("instance.json: " + str(e))

print(json.dumps({"ok": len(errors) == 0, "added": added, "alreadyPresent": already, "errors": errors}))
`

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> },
) {
  if (!isGoadConfigured()) {
    return NextResponse.json({ error: "GOAD SSH not configured." }, { status: 503 })
  }

  const session = await resolveSession(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { instanceId: rawId } = await params
  const instanceId = decodeURIComponent(rawId)
  if (!instanceId) {
    return NextResponse.json({ error: "Missing instance ID" }, { status: 400 })
  }

  if (!session.isAdmin) {
    const effectiveUser = session.username
    if (!instanceId.toLowerCase().startsWith(effectiveUser.toLowerCase() + "-")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
  }

  const body = await request.json().catch(() => ({}))
  const extensionName = typeof (body as { extensionName?: unknown }).extensionName === "string"
    ? String((body as { extensionName: string }).extensionName).trim()
    : ""
  if (!extensionName) {
    return NextResponse.json({ error: "extensionName required" }, { status: 400 })
  }

  const settings = getSettings()
  const goadPath = resolveGoadPath()
  const b64 = (s: string) => Buffer.from(s, "utf-8").toString("base64")

  const rootCreds = rootPasswordCredsIfSet(settings)
  const userCreds =
    session.sshPassword && session.username
      ? { username: session.username, password: session.sshPassword }
      : undefined

  const encoded = Buffer.from(ENABLE_EXT_PY, "utf-8").toString("base64")
  const cmd = `echo '${encoded}' | base64 -d | python3 - '${b64(goadPath)}' '${b64(instanceId)}' '${b64(extensionName)}'`

  const plan = workspaceSshExecPlan(request, session, cmd, rootCreds, userCreds)
  if (!plan.ok) {
    return NextResponse.json({ error: plan.error }, { status: plan.status })
  }

  try {
    const { stdout, stderr, code } = await sshExec(plan.command, plan.creds)
    if (code !== 0) {
      logLuxRouteAction(request, session, { outcome: "failure", detail: `SSH exit ${code}` })
      return NextResponse.json(
        { error: `SSH script failed (exit ${code}): ${(stderr || stdout).slice(0, 500)}` },
        { status: 500 },
      )
    }
    const line = stdout.trim().split("\n").filter(Boolean).pop() ?? ""
    let parsed: {
      ok?: boolean
      added?: boolean
      alreadyPresent?: boolean
      errors?: string[]
    }
    try {
      parsed = JSON.parse(line) as typeof parsed
    } catch {
      logLuxRouteAction(request, session, { outcome: "failure", detail: "Unexpected script output" })
      return NextResponse.json(
        { error: "Unexpected script output", raw: stdout.slice(0, 400) },
        { status: 500 },
      )
    }
    logLuxRouteAction(request, session, {
      detail: `instanceId=${instanceId} extension=${extensionName}`,
    })
    return NextResponse.json({
      ok: parsed.ok ?? true,
      added: parsed.added ?? false,
      alreadyPresent: parsed.alreadyPresent ?? false,
      errors: parsed.errors ?? [],
    })
  } catch (err) {
    logLuxRouteAction(request, session, { outcome: "failure", detail: "enable-extension failed" })
    return NextResponse.json(
      { error: `enable-extension failed: ${(err as Error).message}` },
      { status: 500 },
    )
  }
}
