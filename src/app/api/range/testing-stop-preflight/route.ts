import { NextRequest, NextResponse } from "next/server"
import { resolveAdminImpersonationFromRequest } from "@/lib/admin-impersonation-request"
import { resolveSession } from "@/lib/session"
import {
  formatTestingStopEfiShutdownNotice,
  listTestingStopEfiEnrollCandidates,
} from "@/lib/proxmox-testing-stop-preflight"

/**
 * GET /api/range/testing-stop-preflight?rangeId=
 *
 * Read-only preview: which range VMs need power-off + `qm enroll-efi-keys`
 * before testing **start** snapshot (EFI disk missing ms-cert=2023k).
 * Cached server-side until the range VM set (fingerprint) changes.
 * Path name kept for session/SQLite cache compatibility.
 */
export async function GET(request: NextRequest) {
  const session = await resolveSession(request)
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const rangeId = request.nextUrl.searchParams.get("rangeId")?.trim()
  if (!rangeId) return NextResponse.json({ error: "rangeId required" }, { status: 400 })

  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1"

  const imp = resolveAdminImpersonationFromRequest(session, request)
  const apiKey = imp.apiKey || session.apiKey
  const userOverride = imp.apiKey ? imp.ludusPrincipal ?? undefined : undefined

  const preview = await listTestingStopEfiEnrollCandidates({
    rangeId,
    apiKey,
    userOverride,
    forceRefresh,
  })

  if (!preview.ok) {
    return NextResponse.json({
      ok: false,
      error: preview.error,
      candidates: [],
      notice: null,
      cached: false,
      vmFingerprint: preview.vmFingerprint ?? null,
    })
  }

  return NextResponse.json({
    ok: true,
    candidates: preview.candidates,
    notice:
      preview.candidates.length > 0
        ? formatTestingStopEfiShutdownNotice(preview.candidates)
        : null,
    cached: preview.cached === true,
    vmFingerprint: preview.vmFingerprint ?? null,
  })
}
