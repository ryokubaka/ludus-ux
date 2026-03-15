/**
 * POST /api/goad/instances/[instanceId]/sync-ips
 *
 * Syncs the GOAD instance's Ansible inventory files with the actual IP range
 * assigned by Ludus — without re-deploying any VMs.
 *
 * Background:
 *   GOAD's `provide` command waits for `ludus range deploy` to reach SUCCESS,
 *   then calls get_ip_range() → update_ip_range() → regenerates inventory files
 *   using `10.{rangeNumber}.10` as the real IP prefix.
 *
 *   If the SSH session dies while GOAD is polling (common on slow hardware where
 *   Ludus takes a long time), the IP update step never fires.  The workspace
 *   inventory files keep the original placeholder IPs (e.g. 192.168.56.X) and
 *   `provision_lab` subsequently runs Ansible against the wrong hosts.
 *
 * This endpoint replicates just the IP update step:
 *   1. Calls Ludus API to get the range's rangeNumber
 *   2. Reads instance.json to find the current (stale) ip_range
 *   3. Rewrites instance.json and all workspace inventory files with the correct
 *      `10.{rangeNumber}.10` prefix via SSH
 */

import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { ludusRequest } from "@/lib/ludus-client"
import { sshExec, readGoadRangeId, type SSHCreds } from "@/lib/goad-ssh"
import { getSettings } from "@/lib/settings-store"
import { getInstanceRangeLocal } from "@/lib/goad-instance-range-store"

export const dynamic = "force-dynamic"

export async function POST(
  request: NextRequest,
  { params }: { params: { instanceId: string } }
) {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { instanceId } = params
  const body = await request.json().catch(() => ({}))
  const { ludusRangeId: bodyRangeId } = body as { ludusRangeId?: string }

  const impersonateApiKey = session.isAdmin
    ? request.headers.get("X-Impersonate-Apikey") || null
    : null
  const effectiveApiKey = impersonateApiKey || session.apiKey

  const settings = getSettings()
  const goadPath = settings.goadPath || "/opt/goad-mod"
  const rootCreds: SSHCreds | undefined = settings.proxmoxSshPassword
    ? { username: settings.proxmoxSshUser || "root", password: settings.proxmoxSshPassword }
    : undefined

  // ── 1. Resolve rangeID ────────────────────────────────────────────────────
  let ludusRangeId: string | null = bodyRangeId || null
  if (!ludusRangeId) {
    ludusRangeId = getInstanceRangeLocal(instanceId)
  }
  if (!ludusRangeId) {
    try {
      ludusRangeId = await readGoadRangeId(instanceId, rootCreds) ?? null
    } catch {
      // ignore
    }
  }
  if (!ludusRangeId) {
    return NextResponse.json(
      { error: "No Ludus range associated with this instance. Run 'provide' first." },
      { status: 400 }
    )
  }

  // ── 2. Get rangeNumber from Ludus ─────────────────────────────────────────
  let rangeNumber: number | null = null
  try {
    const res = await ludusRequest<{ rangeNumber?: number; rangeState?: string }>(
      `/range?rangeID=${encodeURIComponent(ludusRangeId)}`,
      { method: "GET", apiKey: effectiveApiKey }
    )
    if (res.error) {
      return NextResponse.json(
        { error: `Ludus range status failed: ${res.error}` },
        { status: 502 }
      )
    }
    rangeNumber = res.data?.rangeNumber ?? null
  } catch (err) {
    return NextResponse.json(
      { error: `Could not reach Ludus API: ${(err as Error).message}` },
      { status: 502 }
    )
  }

  if (rangeNumber === null || rangeNumber === undefined) {
    return NextResponse.json(
      { error: "Ludus returned no rangeNumber — is the range deployed?" },
      { status: 400 }
    )
  }

  const newIpRange = `10.${rangeNumber}.10`
  const safeId = instanceId.replace(/[^a-zA-Z0-9_-]/g, "")
  const workspacePath = `${goadPath}/workspace/${safeId}`

  // ── 3. Read current ip_range from instance.json ───────────────────────────
  let oldIpRange: string | null = null
  try {
    const { stdout } = await sshExec(
      `python3 -c "import json; d=json.load(open('${workspacePath}/instance.json')); print(d.get('ip_range',''))"`,
      rootCreds
    )
    oldIpRange = stdout.trim() || null
  } catch {
    // If we can't read it, we still try to update with a best-effort pattern
  }

  const errors: string[] = []
  const updates: string[] = []

  // ── 4. Update instance.json ───────────────────────────────────────────────
  try {
    const updateJsonCmd =
      `python3 -c "` +
      `import json; ` +
      `path='${workspacePath}/instance.json'; ` +
      `d=json.load(open(path)); ` +
      `d['ip_range']='${newIpRange}'; ` +
      `open(path,'w').write(json.dumps(d, indent=2)); ` +
      `print('[+] instance.json updated')"`
    const { stdout, code } = await sshExec(updateJsonCmd, rootCreds)
    if (code === 0) {
      updates.push("instance.json")
    } else {
      errors.push(`instance.json update failed (exit ${code}): ${stdout}`)
    }
  } catch (err) {
    errors.push(`instance.json update error: ${(err as Error).message}`)
  }

  // ── 5. Rewrite inventory files ────────────────────────────────────────────
  //
  // The workspace inventories were rendered from Jinja2 templates with the
  // initial ip_range.  We replace every occurrence of the stale ip_range
  // prefix with the correct one.  Using `find -exec sed` avoids the for-loop
  // syntax pitfalls that arise from joining multi-line shell with "; ".
  //
  // Two passes:
  //   a) If oldIpRange is known: targeted replacement of the exact old value
  //   b) Fallback: always replace the GOAD default 192.168.56 prefix in case
  //      instance.json was updated but inventories were skipped, or the old
  //      prefix was something else entirely.
  //
  // Dots in the sed pattern must be escaped (\.) so they match only literal
  // dots, not any character.
  const escapedOld = oldIpRange ? oldIpRange.replace(/\./g, "\\.") : null

  // Build a single shell command that is safe to pass to sshExec (no newlines,
  // no for-loops).  find -exec ... + bundles all matching files into one call.
  const findInventories = `find '${workspacePath}' -maxdepth 1 -type f \\( -name 'inventory*' -o -name '*_inventory' \\)`

  const sedCmds: string[] = []
  if (escapedOld) {
    sedCmds.push(`${findInventories} -exec sed -i "s|${escapedOld}|${newIpRange}|g" {} +`)
  }
  // Always also replace the GOAD default fallback so the button works even
  // when instance.json already had the correct prefix but inventories didn't.
  sedCmds.push(`${findInventories} -exec sed -i "s|192\\.168\\.56|${newIpRange}|g" {} +`)
  sedCmds.push(`echo "[+] Inventory sync complete"`)

  const inventoryUpdateCmd = sedCmds.join(" && ")

  try {
    const { stdout, code, stderr } = await sshExec(inventoryUpdateCmd, rootCreds)
    if (code === 0) {
      updates.push("inventory files")
    } else {
      errors.push(`Inventory update exited with code ${code}: ${(stderr || stdout).slice(0, 400)}`)
    }
  } catch (err) {
    errors.push(`Inventory update error: ${(err as Error).message}`)
  }

  return NextResponse.json({
    success: errors.length === 0,
    oldIpRange: oldIpRange ?? "unknown",
    newIpRange,
    rangeNumber,
    updates,
    errors,
  })
}
