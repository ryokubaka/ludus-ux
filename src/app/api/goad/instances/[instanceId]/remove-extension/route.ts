/**
 * POST /api/goad/instances/[instanceId]/remove-extension
 *
 * Cleans up GOAD state for a single extension so a subsequent `provide`
 * does not re-deploy the removed VMs:
 *
 *   1. Drops the extension name from workspace/<id>/instance.json "extensions".
 *   2. Deletes compiled inventory files whose basename contains the extension
 *      slug and the word "inventory" (case-insensitive).
 *   3. Strips VM entries from workspace/<id>/provider/config.yml (singular
 *      `provider`, single file — confirmed against the real GOAD tree) whose
 *      `vm_name` / `hostname` matches the extension. Without this,
 *      `goad ... provide` re-posts the original config to Ludus and the VM
 *      comes back.
 *
 * Uses PyYAML (already required by GOAD/Ansible on the GOAD server). If the
 * yaml module is unavailable the step is skipped and a warning is returned
 * instead of failing the whole request — operators then delete the entry by
 * hand from config.yml.
 */

import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { sshExec, isGoadConfigured } from "@/lib/goad-ssh"
import { rootPasswordCredsIfSet } from "@/lib/root-ssh-auth"
import { getSettings } from "@/lib/settings-store"

export const dynamic = "force-dynamic"

const REMOVE_EXT_PY = `
import json, os, sys, base64

def _b(i):
    return base64.b64decode(sys.argv[i]).decode("utf-8")

goad_path, instance_id, ext = _b(1), _b(2), _b(3)
ws = os.path.join(goad_path, "workspace", instance_id)
inst = os.path.join(ws, "instance.json")
removed_from_instance = False
deleted_files = []
updated_configs = []  # [{"file": "...", "entries": ["ws02", ...]}]
errors = []
ext_l = ext.lower()
ext_short = ext_l.split(".")[0]

try:
    with open(inst, "r", encoding="utf-8") as fh:
        d = json.load(fh)
    ex = list(d.get("extensions") or [])
    if ext in ex:
        d["extensions"] = [x for x in ex if x != ext]
        with open(inst, "w", encoding="utf-8") as fh:
            json.dump(d, fh, indent=2)
        removed_from_instance = True
except Exception as e:
    errors.append("instance.json: " + str(e))

if os.path.isdir(ws):
    for fn in os.listdir(ws):
        fp = os.path.join(ws, fn)
        if not os.path.isfile(fp):
            continue
        fl = fn.lower()
        if "inventory" not in fl:
            continue
        if ext_l not in fl:
            continue
        try:
            os.remove(fp)
            deleted_files.append(fn)
        except Exception as e:
            errors.append(fn + ": " + str(e))

# Strip VM entries from workspace/<id>/provider/config.yml so that a subsequent
# \`provide\` does not re-post them to Ludus and re-deploy the VMs.
try:
    import yaml  # PyYAML; comes with Ansible which GOAD already requires.
except ImportError:
    yaml = None
    errors.append("yaml module unavailable — config.yml not updated; remove the entry manually or pip install PyYAML")

def _vm_matches(entry):
    if not isinstance(entry, dict):
        return False
    for k in ("vm_name", "hostname"):
        v = entry.get(k)
        if not isinstance(v, str):
            continue
        vl = v.lower()
        vs = vl.split(".")[0]
        if vl == ext_l or vs == ext_l or vl == ext_short or vs == ext_short:
            return True
        if ext_short and len(ext_short) >= 3 and ext_short in vs:
            return True
    return False

provider_cfg = os.path.join(ws, "provider", "config.yml")
if yaml and os.path.isfile(provider_cfg):
    try:
        with open(provider_cfg, "r", encoding="utf-8") as fh:
            data = yaml.safe_load(fh)
    except Exception as e:
        errors.append("provider/config.yml read: " + str(e))
        data = None
    if isinstance(data, dict):
        removed_here = []
        # Known shape: top-level "ludus" is a list of VM dicts. Also tolerate
        # any other top-level list-of-dicts with vm_name/hostname keys in case
        # GOAD adds further lists in the future.
        for key, value in list(data.items()):
            if not isinstance(value, list):
                continue
            if not any(isinstance(x, dict) and ("vm_name" in x or "hostname" in x) for x in value):
                continue
            kept = []
            for entry in value:
                if _vm_matches(entry):
                    removed_here.append(
                        str(entry.get("vm_name") or entry.get("hostname") or "")
                    )
                else:
                    kept.append(entry)
            data[key] = kept

        if removed_here:
            try:
                with open(provider_cfg, "w", encoding="utf-8") as fh:
                    yaml.safe_dump(data, fh, default_flow_style=False, sort_keys=False)
                updated_configs.append({
                    "file": "provider/config.yml",
                    "entries": removed_here,
                })
            except Exception as e:
                errors.append("provider/config.yml write: " + str(e))

out = {
    "ok": len(errors) == 0 or removed_from_instance or len(deleted_files) > 0 or len(updated_configs) > 0,
    "removedFromInstance": removed_from_instance,
    "deletedFiles": deleted_files,
    "updatedConfigs": updated_configs,
    "errors": errors,
}
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

  if (!session.isAdmin) {
    const impersonateAs = request.headers.get("X-Impersonate-As")
    const effectiveUser = impersonateAs || session.username
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

  const encoded = Buffer.from(REMOVE_EXT_PY, "utf-8").toString("base64")
  const cmd = `echo '${encoded}' | base64 -d | python3 - '${b64(goadPath)}' '${b64(instanceId)}' '${b64(extensionName)}'`

  try {
    const { stdout, stderr, code } = await sshExec(cmd, creds)
    if (code !== 0) {
      return NextResponse.json(
        { error: `SSH script failed (exit ${code}): ${(stderr || stdout).slice(0, 500)}` },
        { status: 500 },
      )
    }
    const line = stdout.trim().split("\n").filter(Boolean).pop() ?? ""
    let parsed: {
      ok?: boolean
      removedFromInstance?: boolean
      deletedFiles?: string[]
      updatedConfigs?: { file: string; entries: string[] }[]
      errors?: string[]
    }
    try {
      parsed = JSON.parse(line) as typeof parsed
    } catch {
      return NextResponse.json(
        { error: "Unexpected script output", raw: stdout.slice(0, 400) },
        { status: 500 },
      )
    }
    return NextResponse.json({
      ok: parsed.ok ?? true,
      removedFromInstance: parsed.removedFromInstance ?? false,
      deletedFiles: parsed.deletedFiles ?? [],
      updatedConfigs: parsed.updatedConfigs ?? [],
      errors: parsed.errors ?? [],
    })
  } catch (err) {
    return NextResponse.json(
      { error: `remove-extension failed: ${(err as Error).message}` },
      { status: 500 },
    )
  }
}
