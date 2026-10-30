import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/session/require-admin"
import { queryAppLogs, formatAppLogLine, type LogCategory } from "@/lib/logs/app-log"


export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request)
  if (!admin.ok) return admin.response

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
