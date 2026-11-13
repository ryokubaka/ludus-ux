import { readFileSync } from "node:fs"
import path from "node:path"
import { NextRequest, NextResponse } from "next/server"
import { finishAdminResponse, requireAdmin } from "@/lib/session/require-admin"
import { luxHostManualInstallCommand } from "@/lib/lux/lux-host-manual-command"

/**
 * The install paste includes the full lux-host script. Build it when the
 * settings dialog opens so the settings document does not carry the script.
 */
export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request)
  if (!admin.ok) return admin.response
  const user = request.nextUrl.searchParams.get("user") ?? ""
  let script: string
  try {
    script = readFileSync(path.join(process.cwd(), "scripts", "lux-host", "lux-host"), "utf8")
  } catch {
    return finishAdminResponse(
      NextResponse.json({ error: "lux-host script is missing" }, { status: 500 }),
      admin,
    )
  }
  try {
    const command = luxHostManualInstallCommand(user, script)
    return finishAdminResponse(NextResponse.json({ command }), admin)
  } catch (err) {
    return finishAdminResponse(
      NextResponse.json(
        { error: err instanceof Error ? err.message : "Enter a plain Linux username." },
        { status: 400 },
      ),
      admin,
    )
  }
}
