/**
 * POST /api/goad/instances/[instanceId]/sync-network
 *
 * Injects the caller-supplied `network:` and/or `ludus_extensions` blocks into
 * the GOAD **instance** Ludus config on the server — primarily
 * `workspace/<id>/provider/config.yml` (GOAD: `GoadPath.get_instance_provider_path`).
 * Some trees still use `workspace/<id>/providers/ludus/config.yml`; we update
 * whichever file exists (prefer `provider/config.yml` when both exist).
 *
 * Why not just rely on the post-action restore in goad/[id]/page.tsx?
 *
 *   GOAD writes `workspace/<id>/provider/config.yml` (Ludus `range config set -f config.yml` cwd)
 *   (containing `ludus:` VM entries rendered from extension templates), then
 *   calls `ludus range config set -c <that file>` BEFORE the Ansible deploy
 *   runs. At that point Ludus replaces range-config.yml wholesale — any
 *   `network:` / `ludus_extensions` the user saved via Range Configuration is
 *   gone. The subsequent deploy runs Ansible against the wiped config, which
 *   FLUSHES iptables on the router (and drops extensions metadata). Restoring
 *   the YAML afterwards puts the rules back on disk but the router stays
 *   flushed until another deploy runs.
 *
 *   Pre-injecting into the workspace config.yml dodges this window: GOAD's PUT
 *   carries the user's keys forward, so Ludus range-config is never actually
 *   wiped and the deploy applies iptables with the rules intact. The
 *   post-action restore + network-tag deploy remains in place as a safety net
 *   for `provide`, which regenerates config.yml from templates and will usually
 *   drop our injection.
 *
 * Body:  { network?: object | null, ludus_extensions?: unknown }
 *   - `network` present: inject/replace (null deletes the block + sidecar)
 *   - `ludus_extensions` present: inject/replace (null deletes + sidecar)
 *   At least one of the two keys must be present.
 * Reply: { ok, updated, file, error? }
 */

import { NextRequest, NextResponse } from "next/server"
import { resolveSession } from "@/lib/session"
import { sshExec, isGoadConfigured, workspaceSshExecPlan } from "@/lib/goad-ssh"
import { rootPasswordCredsIfSet } from "@/lib/root-ssh-auth"
import { getSettings } from "@/lib/settings-store"
import { resolveGoadPath } from "@/lib/runtime-paths"
import { logLuxRouteAction } from "@/lib/lux-api-audit"


const SYNC_NETWORK_PY = `
import json, os, sys, base64

def _b(i):
    return base64.b64decode(sys.argv[i]).decode("utf-8")

goad_path, instance_id, network_json, extensions_json = _b(1), _b(2), _b(3), _b(4)
ws = os.path.join(goad_path, "workspace", instance_id)
_cfg_candidates = [
    os.path.join(ws, "provider", "config.yml"),
    os.path.join(ws, "providers", "ludus", "config.yml"),
]
cfg_path = next((p for p in _cfg_candidates if os.path.isfile(p)), None)
provider_dir = os.path.dirname(cfg_path) if cfg_path else ""
net_sidecar = os.path.join(provider_dir, ".lux-network-snapshot.json") if provider_dir else ""
ext_sidecar = os.path.join(provider_dir, ".lux-extensions-snapshot.json") if provider_dir else ""

out = {"ok": False, "updated": False, "file": (os.path.relpath(cfg_path, ws) if cfg_path else "provider/config.yml")}

try:
    import yaml
except ImportError:
    out["error"] = "PyYAML not installed on GOAD host — skip"
    print(json.dumps(out))
    sys.exit(0)

if not cfg_path:
    out["error"] = (
        "workspace Ludus config.yml not found — expected provider/config.yml "
        "or providers/ludus/config.yml (run Provide first)"
    )
    print(json.dumps(out))
    sys.exit(0)

# Empty argv means "key not provided"; JSON "null" means explicit delete.
has_network = network_json != ""
has_extensions = extensions_json != ""
try:
    network = json.loads(network_json) if has_network else None
except Exception as e:
    out["error"] = "invalid network payload: " + str(e)
    print(json.dumps(out))
    sys.exit(0)
try:
    extensions = json.loads(extensions_json) if has_extensions else None
except Exception as e:
    out["error"] = "invalid ludus_extensions payload: " + str(e)
    print(json.dumps(out))
    sys.exit(0)

try:
    with open(cfg_path, "r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    if not isinstance(data, dict):
        out["error"] = "config.yml root is not a mapping"
        print(json.dumps(out))
        sys.exit(0)

    if has_network:
        existing = data.get("network")
        if network is None:
            if "network" in data:
                del data["network"]
                out["updated"] = True
            if os.path.isfile(net_sidecar):
                os.remove(net_sidecar)
        else:
            if existing != network:
                data["network"] = network
                out["updated"] = True
            with open(net_sidecar, "w", encoding="utf-8") as fh:
                json.dump(network, fh)

    if has_extensions:
        existing_ext = data.get("ludus_extensions")
        if extensions is None:
            if "ludus_extensions" in data:
                del data["ludus_extensions"]
                out["updated"] = True
            if os.path.isfile(ext_sidecar):
                os.remove(ext_sidecar)
        else:
            if existing_ext != extensions:
                data["ludus_extensions"] = extensions
                out["updated"] = True
            with open(ext_sidecar, "w", encoding="utf-8") as fh:
                json.dump(extensions, fh)

    if out["updated"]:
        with open(cfg_path, "w", encoding="utf-8") as fh:
            yaml.safe_dump(data, fh, default_flow_style=False, sort_keys=False)
    # Sidecar-only write (config already matched) still counts as success.
    out["ok"] = True
except Exception as e:
    out["error"] = str(e)

print(json.dumps(out))
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

  // Same ownership check as remove-extension: non-admins can only touch
  // instances whose id is prefixed with their own (or impersonated) username.
  if (!session.isAdmin) {
    const effectiveUser = session.username
    if (!instanceId.toLowerCase().startsWith(effectiveUser.toLowerCase() + "-")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
  }

  const body = (await request.json().catch(() => ({}))) as {
    network?: unknown
    ludus_extensions?: unknown
  }
  const hasNetwork = Object.prototype.hasOwnProperty.call(body, "network")
  const hasExtensions = Object.prototype.hasOwnProperty.call(body, "ludus_extensions")
  if (!hasNetwork && !hasExtensions) {
    return NextResponse.json(
      { error: "Provide network and/or ludus_extensions" },
      { status: 400 },
    )
  }

  const network = hasNetwork ? body.network : undefined
  if (
    hasNetwork &&
    network !== null &&
    (typeof network !== "object" || Array.isArray(network))
  ) {
    return NextResponse.json(
      { error: "network must be an object or null" },
      { status: 400 },
    )
  }

  const settings = getSettings()
  const goadPath = resolveGoadPath()
  const b64 = (s: string) => Buffer.from(s, "utf-8").toString("base64")

  const rootCreds = rootPasswordCredsIfSet(settings)
  const userCreds =
    session.sshPassword && session.username
      ? { username: session.username, password: session.sshPassword }
      : undefined

  const encoded = Buffer.from(SYNC_NETWORK_PY, "utf-8").toString("base64")
  // Empty string = key omitted; JSON null/value = explicit sync.
  const networkArg = hasNetwork ? JSON.stringify(network ?? null) : ""
  const extensionsArg = hasExtensions ? JSON.stringify(body.ludus_extensions ?? null) : ""
  const cmd =
    `echo '${encoded}' | base64 -d | python3 - ` +
    `'${b64(goadPath)}' '${b64(instanceId)}' '${b64(networkArg)}' '${b64(extensionsArg)}'`

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
    let parsed: { ok?: boolean; updated?: boolean; file?: string; error?: string }
    try {
      parsed = JSON.parse(line) as typeof parsed
    } catch {
      logLuxRouteAction(request, session, { outcome: "failure", detail: "Unexpected script output" })
      return NextResponse.json(
        { error: "Unexpected script output", raw: stdout.slice(0, 400) },
        { status: 500 },
      )
    }
    logLuxRouteAction(request, session, { detail: `instanceId=${instanceId} updated=${parsed.updated ?? false}` })
    return NextResponse.json({
      ok: parsed.ok ?? false,
      updated: parsed.updated ?? false,
      file: parsed.file ?? "provider/config.yml",
      ...(parsed.error ? { error: parsed.error } : {}),
    })
  } catch (err) {
    logLuxRouteAction(request, session, { outcome: "failure", detail: "sync-network failed" })
    return NextResponse.json(
      { error: `sync-network failed: ${(err as Error).message}` },
      { status: 500 },
    )
  }
}
