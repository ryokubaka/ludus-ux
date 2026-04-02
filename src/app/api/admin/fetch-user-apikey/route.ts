import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { sshExec } from "@/lib/goad-ssh"

export const dynamic = "force-dynamic"

/**
 * GET /api/admin/fetch-user-apikey?username=xxx
 *
 * Reads the LUDUS_API_KEY for a user from their ~/.bashrc over root SSH,
 * so admins do not need to manually enter it when impersonating.
 *
 * Admin-only endpoint.
 */
export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const username = searchParams.get("username")
  if (!username || !/^[a-zA-Z0-9_.-]+$/.test(username)) {
    return NextResponse.json({ error: "Valid username required" }, { status: 400 })
  }

  try {
    // Extract LUDUS_API_KEY from the user's .bashrc via root SSH.
    // Uses grep -oP (Perl regex) with \K to return only the value part.
    // Handles both:  export LUDUS_API_KEY=VALUE  and  LUDUS_API_KEY=VALUE
    // Also handles single-quoted values:  export LUDUS_API_KEY='VALUE'
    const cmd = [
      `grep -E '^[[:space:]]*(export[[:space:]]+)?LUDUS_API_KEY=' /home/${username}/.bashrc 2>/dev/null`,
      `tail -1`,
      `grep -oP "LUDUS_API_KEY=['\"]?\\K[^'\"\\s]+"`,
    ].join(" | ")

    const { stdout, code } = await sshExec(cmd)

    const apiKey = stdout.trim()
    if (code !== 0 || !apiKey) {
      return NextResponse.json({ apiKey: null, message: "Key not found in ~/.bashrc" })
    }

    return NextResponse.json({ apiKey })
  } catch (err) {
    console.error("fetch-user-apikey error:", err)
    return NextResponse.json({ apiKey: null, message: "SSH error reading ~/.bashrc" })
  }
}
