import { NextRequest, NextResponse } from "next/server"
import { getInstanceInventories, isGoadConfigured } from "@/lib/goad/goad-ssh"
import { assertGoadInstanceAccess } from "@/lib/goad/goad-instance-access"
import { resolveSession } from "@/lib/session/session"


export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> }
) {
  const session = await resolveSession(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  if (!isGoadConfigured()) {
    return NextResponse.json(
      { error: "GOAD SSH not configured." },
      { status: 503 }
    )
  }

  const { instanceId } = await params
  const decoded = decodeURIComponent(instanceId)
  if (!decoded) {
    return NextResponse.json({ error: "Missing instance ID" }, { status: 400 })
  }

  const denied = await assertGoadInstanceAccess(session, request, decoded)
  if (denied) return denied

  const creds = session.sshPassword
    ? { username: session.username, password: session.sshPassword }
    : undefined

  try {
    const inventories = await getInstanceInventories(decoded, creds)
    return NextResponse.json({ inventories })
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to read inventories: ${(err as Error).message}` },
      { status: 500 }
    )
  }
}
