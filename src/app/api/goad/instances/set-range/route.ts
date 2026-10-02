/**
 * POST /api/goad/instances/set-range
 *
 * Writes a rangeId to the .goad_range_id tracking file for one or more GOAD
 * instance workspaces. Called after a new-instance deploy completes to link
 * the newly created instance(s) with the pre-created dedicated Ludus range.
 * An admin chowns the workspace to its owner before the range file is written,
 * once a host-account GOAD process is no longer writing that directory.
 * SQLite is updated only after that file write succeeds.
 *
 * Body: { rangeId: string; instanceIds: string[] }
 */

import { NextRequest, NextResponse } from "next/server"
import { resolveAdminImpersonationFromRequest } from "@/lib/admin-impersonation-request"
import { resolveSession } from "@/lib/session"
import { parseJsonBody } from "@/lib/require-session"
import {
  goadCommandRunsAsHostAccount,
  setRangeHostProcessActive,
  shouldDeferHostWorkspaceChown,
} from "@/lib/goad-deploy-link"
import { chownGoadInstance, listGoadInstances, sshExecAsWorkspaceUser, workspaceOwnerLinuxUser, writeGoadRangeId } from "@/lib/goad-ssh"
import { setInstanceRangeLocal } from "@/lib/goad-instance-range-store"
import { logLuxRouteAction } from "@/lib/lux-api-audit"
import { effectivePrivilegedSshUser } from "@/lib/root-ssh-preflight"
import { getSettings } from "@/lib/settings-store"


export async function POST(request: NextRequest) {
  const session = await resolveSession(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const body = await parseJsonBody<{ rangeId?: string; instanceIds?: string[] }>(request)

  const { rangeId, instanceIds } = body
  if (!rangeId || !Array.isArray(instanceIds) || instanceIds.length === 0) {
    return NextResponse.json({ error: "rangeId and instanceIds are required" }, { status: 400 })
  }

  const userCreds =
    session.sshPassword && session.username
      ? { username: session.username, password: session.sshPassword }
      : undefined
  const runAsOwner = (command: string) =>
    sshExecAsWorkspaceUser(request, session, command, userCreds)
  const owner = workspaceOwnerLinuxUser(session, request)
  const imp = resolveAdminImpersonationFromRequest(session, request)
  const runsAsHost = goadCommandRunsAsHostAccount({
    sshPassword: session.sshPassword,
    impersonating: session.isAdmin === true && !!imp.apiKey,
  })
  const hostUser = effectivePrivilegedSshUser(getSettings().proxmoxSshUser)
  const owners = new Map<string, string>()
  if (runsAsHost && instanceIds.some((id) => setRangeHostProcessActive(id))) {
    try {
      const listed = await listGoadInstances()
      for (const inst of listed) owners.set(inst.instanceId, inst.ownerUserId?.trim() ?? "")
    } catch {
      owners.clear()
    }
  }

  const results: { instanceId: string; ok: boolean; error?: string }[] = []

  for (const instanceId of instanceIds) {
    const hostProcessActive = runsAsHost && setRangeHostProcessActive(instanceId)
    if (
      shouldDeferHostWorkspaceChown({
        directoryOwner: owners.get(instanceId) ?? "",
        targetUser: owner ?? "",
        hostUser,
        hostProcessActive,
      })
    ) {
      results.push({ instanceId, ok: false, error: "GOAD is still writing this workspace" })
      continue
    }
    try {
      if (session.isAdmin && owner && owner.toLowerCase() !== "root") {
        await chownGoadInstance(instanceId, owner)
      }
      await writeGoadRangeId(instanceId, rangeId, runAsOwner)
      setInstanceRangeLocal(instanceId, rangeId)
      results.push({ instanceId, ok: true })
    } catch (err) {
      results.push({ instanceId, ok: false, error: (err as Error).message })
    }
  }

  const allOk = results.every((r) => r.ok)
  logLuxRouteAction(request, session, {
    outcome: allOk ? "success" : "failure",
    detail: `rangeId=${rangeId} instances=${instanceIds.length}`,
  })
  return NextResponse.json({ ok: allOk, results }, { status: allOk ? 200 : 207 })
}
