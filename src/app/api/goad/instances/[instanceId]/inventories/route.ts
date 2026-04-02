import { NextRequest, NextResponse } from "next/server"
import { getInstanceInventories, isGoadConfigured } from "@/lib/goad-ssh"
import { getSessionFromRequest } from "@/lib/session"

export const dynamic = "force-dynamic"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> }
) {
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

  const session = await getSessionFromRequest(_request)
  const creds = session?.sshPassword
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
