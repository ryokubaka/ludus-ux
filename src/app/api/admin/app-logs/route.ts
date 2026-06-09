import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { queryAppLogs, formatAppLogLine, type LogCategory } from "@/lib/app-log"


export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }

  const categoryParam = request.nextUrl.searchParams.get("category")
  const category =
    categoryParam === "auth" || categoryParam === "app" ? (categoryParam as LogCategory) : undefined
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? "200")
  const beforeParam = request.nextUrl.searchParams.get("before")
  const before = beforeParam ? Number(beforeParam) : undefined

  const rows = queryAppLogs({ category, limit, before })
  return NextResponse.json({
    lines: rows.map((r) => formatAppLogLine(r)),
    rows,
  })
}
