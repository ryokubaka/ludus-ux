/**
 * POST /api/goad/instances/[instanceId]/sync-network
 *
 * Injects the caller-supplied `network:` block into the GOAD **instance**
 * Ludus config on the server — primarily `workspace/<id>/provider/config.yml`
 * (GOAD / goad-mod: `GoadPath.get_instance_provider_path`). Some trees still
 * use `workspace/<id>/providers/ludus/config.yml`; we update whichever file
 * exists (prefer `provider/config.yml` when both exist).
 *
 * Why not just rely on the post-action restore in goad/[id]/page.tsx?
 *
 *   GOAD writes `workspace/<id>/provider/config.yml` (Ludus `range config set -f config.yml` cwd)
 *   (containing `ludus:` VM entries rendered from extension templates), then
 *   calls `ludus range config set -c <that file>` BEFORE the Ansible deploy
 *   runs. At that point Ludus replaces range-config.yml wholesale — any
 *   `network:` block the user saved via Range Configuration is gone. The
 *   subsequent deploy runs Ansible against the wiped config, which FLUSHES
 *   iptables on the router. Restoring the YAML afterwards puts the rules
 *   back on disk but the router stays flushed until another deploy runs.
 *
 *   Pre-injecting `network:` into the workspace config.yml dodges this
 *   window: GOAD's PUT carries the user's rules forward, so Ludus
 *   range-config is never actually wiped and the deploy applies iptables
 *   with the rules intact. The post-action restore + network-tag deploy
 *   remains in place as a safety net for `provide`, which regenerates
 *   config.yml from templates and will usually drop our injection.
 *
 * Body:  { network: {…} | null } — a parsed YAML object, not a YAML string.
 *                                   null deletes the block.
 * Reply: { ok, updated, file, error? }
 */

import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { sshExec, isGoadConfigured } from "@/lib/goad-ssh"
import { rootPasswordCredsIfSet } from "@/lib/root-ssh-auth"
import { getSettings } from "@/lib/settings-store"

export const dynamic = "force-dynamic"

const SYNC_NETWORK_PY = `
import json, os, sys, base64

def _b(i):
    return base64.b64decode(sys.argv[i]).decode("utf-8")

goad_path, instance_id, network_json = _b(1), _b(2), _b(3)
ws = os.path.join(goad_path, "workspace", instance_id)
_cfg_candidates = [
    os.path.join(ws, "provider", "config.yml"),
    os.path.join(ws, "providers", "ludus", "config.yml"),
]
cfg_path = next((p for p in _cfg_candidates if os.path.isfile(p)), None)
provider_dir = os.path.dirname(cfg_path) if cfg_path else ""
sidecar_path = os.path.join(provider_dir, ".lux-network-snapshot.json") if provider_dir else ""

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

try:
    network = json.loads(network_json) if network_json else None
except Exception as e:
    out["error"] = "invalid network payload: " + str(e)
    print(json.dumps(out))
    sys.exit(0)

try:
    with open(cfg_path, "r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    if not isinstance(data, dict):
        out["error"] = "config.yml root is not a mapping"
        print(json.dumps(out))
        sys.exit(0)
    existing = data.get("network")
    if network is None:
        if "network" in data:
            del data["network"]
            out["updated"] = True
        if os.path.isfile(sidecar_path):
            os.remove(sidecar_path)
    else:
        if existing != network:
            data["network"] = network
            out["updated"] = True
        with open(sidecar_path, "w", encoding="utf-8") as fh:
            json.dump(network, fh)
    if out["updated"]:
        with open(cfg_path, "w", encoding="utf-8") as fh:
            yaml.safe_dump(data, fh, default_flow_style=False, sort_keys=False)
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

  const session = await getSessionFromRequest(request)
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
    const impersonateAs = request.headers.get("X-Impersonate-As")
    const effectiveUser = impersonateAs || session.username
    if (!instanceId.toLowerCase().startsWith(effectiveUser.toLowerCase() + "-")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
  }

  const body = (await request.json().catch(() => ({}))) as { network?: unknown }
  // Accept either an object (inject/replace) or explicit null (remove).
  const network = body.network === undefined ? null : body.network
  if (network !== null && (typeof network !== "object" || Array.isArray(network))) {
    return NextResponse.json(
      { error: "network must be an object or null" },
      { status: 400 },
    )
  }

  const settings = getSettings()
  const goadPath = settings.goadPath || "/opt/GOAD"
  const b64 = (s: string) => Buffer.from(s, "utf-8").toString("base64")

  const rootCreds = rootPasswordCredsIfSet(settings)
  const userCreds =
    session.sshPassword && session.username
      ? { username: session.username, password: session.sshPassword }
      : undefined
  const creds = rootCreds ?? userCreds
  if (!creds) {
    return NextResponse.json(
      { error: "No SSH credentials available (set root SSH password or log in with SSH password)." },
      { status: 503 },
    )
  }

  const encoded = Buffer.from(SYNC_NETWORK_PY, "utf-8").toString("base64")
  const networkArg = network === null ? "" : JSON.stringify(network)
  const cmd = `echo '${encoded}' | base64 -d | python3 - '${b64(goadPath)}' '${b64(instanceId)}' '${b64(networkArg)}'`

  try {
    const { stdout, stderr, code } = await sshExec(cmd, creds)
    if (code !== 0) {
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
      return NextResponse.json(
        { error: "Unexpected script output", raw: stdout.slice(0, 400) },
        { status: 500 },
      )
    }
    return NextResponse.json({
      ok: parsed.ok ?? false,
      updated: parsed.updated ?? false,
      file: parsed.file ?? "provider/config.yml",
      ...(parsed.error ? { error: parsed.error } : {}),
    })
  } catch (err) {
    return NextResponse.json(
      { error: `sync-network failed: ${(err as Error).message}` },
      { status: 500 },
    )
  }
}
