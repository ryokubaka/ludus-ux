/**
 * POST /api/goad/instances/[instanceId]/refresh-workspace
 *
 * Prepares a GOAD workspace for re-deploy into an existing Ludus range (LUX-only;
 * no GOAD patches required):
 *
 *   1. Sets instance.json "extensions" to the wizard selection (when provided).
 *   2. Removes stale extension inventory files (*_inventory) no longer listed.
 *
 * Call before GOAD REPL `use …;update_instance_files;provide` so config.yml and
 * inventories regenerate from current lab templates + extension list.
 */

import { NextRequest, NextResponse } from "next/server"
import { resolveSession } from "@/lib/session"
import { sshExec, isGoadConfigured, workspaceSshExecPlan } from "@/lib/goad-ssh"
import { rootPasswordCredsIfSet } from "@/lib/root-ssh-auth"
import { getSettings } from "@/lib/settings-store"
import { logLuxRouteAction } from "@/lib/lux-api-audit"


const REFRESH_WORKSPACE_PY = `
import json, os, sys, base64

def _b(i):
    return base64.b64decode(sys.argv[i]).decode("utf-8")

goad_path = _b(1)
instance_id = _b(2)
extensions_json = _b(3)
ws = os.path.join(goad_path, "workspace", instance_id)
inst = os.path.join(ws, "instance.json")
out = {"ok": False, "extensions": [], "removedInventories": [], "errors": []}

if not os.path.isdir(ws):
    out["errors"].append("workspace not found")
    print(json.dumps(out))
    sys.exit(1)

try:
    extensions = json.loads(extensions_json)
    if not isinstance(extensions, list):
        raise ValueError("extensions must be a JSON array")
    extensions = [str(x) for x in extensions]
except Exception as e:
    out["errors"].append("extensions parse: " + str(e))
    print(json.dumps(out))
    sys.exit(1)

try:
    with open(inst, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    data["extensions"] = extensions
    with open(inst, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=4)
        fh.write("\\n")
    out["extensions"] = extensions
except Exception as e:
    out["errors"].append("instance.json: " + str(e))
    print(json.dumps(out))
    sys.exit(1)

ext_set = set(extensions)
for fn in os.listdir(ws):
    if not fn.endswith("_inventory"):
        continue
    ext_name = fn[: -len("_inventory")]
    if ext_name in ext_set:
        continue
    fp = os.path.join(ws, fn)
    if not os.path.isfile(fp):
        continue
    try:
        os.remove(fp)
        out["removedInventories"].append(fn)
    except Exception as e:
        out["errors"].append(fn + ": " + str(e))

out["ok"] = True
print(json.dumps(out))
`

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> }
) {
  const session = await resolveSession(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  if (!isGoadConfigured()) {
    return NextResponse.json({ error: "GOAD is not configured" }, { status: 503 })
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
  const { extensions } = body as { extensions?: string[] }

  if (!Array.isArray(extensions)) {
    return NextResponse.json({ error: "extensions array is required" }, { status: 400 })
  }

  const settings = getSettings()
  const goadPath = settings.goadPath || "/opt/GOAD"
  const rootCreds = rootPasswordCredsIfSet(settings)
  const userCreds =
    session.sshPassword && session.username
      ? { username: session.username, password: session.sshPassword }
      : undefined

  const b64 = (s: string) => Buffer.from(s, "utf-8").toString("base64")
  const encoded = Buffer.from(REFRESH_WORKSPACE_PY, "utf-8").toString("base64")
  const cmd = `echo '${encoded}' | base64 -d | python3 - '${b64(goadPath)}' '${b64(instanceId)}' '${b64(JSON.stringify(extensions))}'`

  const plan = workspaceSshExecPlan(request, session, cmd, rootCreds, userCreds)
  if (!plan.ok) {
    return NextResponse.json({ error: plan.error }, { status: plan.status })
  }

  try {
    const { stdout, stderr, code } = await sshExec(plan.command, plan.creds)
    if (code !== 0) {
      logLuxRouteAction(request, session, {
        outcome: "failure",
        detail: `refresh-workspace instanceId=${instanceId} exit=${code}`,
      })
      return NextResponse.json(
        { error: `SSH script failed (exit ${code}): ${(stderr || stdout).slice(0, 500)}` },
        { status: 500 },
      )
    }

    const line = stdout.trim().split("\n").filter(Boolean).pop() ?? "{}"
    const parsed = JSON.parse(line) as {
      ok?: boolean
      extensions?: string[]
      removedInventories?: string[]
      errors?: string[]
    }

    if (!parsed.ok) {
      return NextResponse.json(
        { error: parsed.errors?.join("; ") || "refresh-workspace failed" },
        { status: 500 },
      )
    }

    logLuxRouteAction(request, session, {
      outcome: "success",
      detail: `refresh-workspace instanceId=${instanceId}`,
    })
    return NextResponse.json({
      ok: true,
      extensions: parsed.extensions ?? extensions,
      removedInventories: parsed.removedInventories ?? [],
    })
  } catch (err) {
    logLuxRouteAction(request, session, {
      outcome: "failure",
      detail: `refresh-workspace instanceId=${instanceId} ${(err as Error).message}`,
    })
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
