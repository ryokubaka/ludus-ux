import { NextRequest, NextResponse } from "next/server"
import { resolveLudushoundSession } from "@/lib/ludushound-session"
import { listLudushoundWorkspaces } from "@/lib/ludushound-ssh"

export async function GET(request: NextRequest) {
  const ctx = await resolveLudushoundSession(request)
  if (!ctx) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  try {
    const workspaces = await listLudushoundWorkspaces(ctx.creds)
    return NextResponse.json({ workspaces })
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message, workspaces: [] },
      { status: 500 },
    )
  }
}
