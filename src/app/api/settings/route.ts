import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { getSettings, updateSettings, type RuntimeSettings } from "@/lib/settings-store"
import { invalidateCatalogCache } from "@/lib/goad-ssh"

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  return NextResponse.json(getSettings())
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }
  if (!session.isAdmin) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  const patch: Partial<RuntimeSettings> = {}
  if (typeof body.ludusUrl === "string") patch.ludusUrl = body.ludusUrl.trim()
  if (typeof body.ludusAdminUrl === "string") patch.ludusAdminUrl = body.ludusAdminUrl.trim()
  if (typeof body.verifyTls === "boolean") patch.verifyTls = body.verifyTls
  if (typeof body.sshHost === "string") patch.sshHost = body.sshHost.trim()
  if (typeof body.sshPort === "number") patch.sshPort = body.sshPort
  if (typeof body.goadPath === "string") patch.goadPath = body.goadPath.trim()
  if (typeof body.proxmoxSshUser === "string") patch.proxmoxSshUser = body.proxmoxSshUser.trim()
  if (typeof body.proxmoxSshPassword === "string") patch.proxmoxSshPassword = body.proxmoxSshPassword

  const updated = updateSettings(patch)
  // Invalidate cached catalog if goadPath changed
  if ("goadPath" in patch) {
    invalidateCatalogCache()
  }
  return NextResponse.json(updated)
}
