import { NextRequest } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { ludusGet } from "@/lib/ludus-client"
import { getSettings } from "@/lib/settings-store"
import { sshExec } from "@/lib/proxmox-ssh"

export const dynamic = "force-dynamic"

/** Read the GOAD ansible log (SSH-based). Returns new lines since lastLineCount. */
async function readGoadLog(
  settings: ReturnType<typeof getSettings>,
  rangeId: string,
  lastCount: number,
): Promise<{ lines: string[]; newCount: number }> {
  if (!settings.sshHost || !settings.proxmoxSshPassword) return { lines: [], newCount: lastCount }
  try {
    // Ludus v2 stores range files under /opt/ludus/ranges/<rangeID>/
    const logPath = `/opt/ludus/ranges/${rangeId}/ansible.log`
    const content = await sshExec(
      settings.sshHost, settings.sshPort,
      settings.proxmoxSshUser || "root", settings.proxmoxSshPassword,
      `cat "${logPath}" 2>/dev/null || true`
    )
    const allLines = content.split("\n").filter((l) => l.trim())
    const newLines = allLines.slice(lastCount)
    return { lines: newLines, newCount: allLines.length }
  } catch {
    return { lines: [], newCount: lastCount }
  }
}

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session) {
    return new Response("data: [ERROR] Not authenticated\n\n", { status: 401 })
  }

  const encoder = new TextEncoder()
  const searchParams = request.nextUrl.searchParams
  const userId = searchParams.get("user") || undefined
  // Explicit rangeId allows per-range log streaming in multi-range environments
  const rangeIdParam = searchParams.get("rangeId") || undefined
  const settings = getSettings()

  // Support admin impersonation: use the impersonated user's API key
  const impersonateApiKey = session.isAdmin
    ? request.headers.get("X-Impersonate-Apikey") || null
    : null
  const effectiveApiKey = impersonateApiKey || session.apiKey

  const stream = new ReadableStream({
    async start(controller) {
      const send = (prefix: string, data: string) => {
        controller.enqueue(encoder.encode(`data: [${prefix}] ${data}\n\n`))
      }

      try {
        let lastLudusCount = 0
        let lastGoadCount = 0
        let rangeId = rangeIdParam || ""
        let maxPolls = 360  // 12 min max

        // Warmup: don't terminate just because the range isn't DEPLOYING yet on
        // the first few checks.  A testing-mode toggle takes a few seconds for
        // Ludus to queue and start.  We allow up to WARMUP_POLLS iterations
        // (each 2 s) before giving up if we never see DEPLOYING.
        const WARMUP_POLLS = 20  // 40 s warmup window
        let warmupRemaining  = WARMUP_POLLS
        let wasDeploying     = false

        while (maxPolls-- > 0) {
          if (request.signal.aborted) break

          // ── Ludus range logs ───────────────────────────────────────────────
          const logPath = `/range/logs${rangeId ? `?rangeID=${rangeId}` : userId ? `?userID=${userId}` : ""}`
          const result = await ludusGet<{ cursor: number; result: string }>(
            logPath, { apiKey: effectiveApiKey }
          )

          if (result.data) {
            const logText = result.data.result || ""
            const allLines = logText.split("\n").filter((l) => l.trim())
            const newLines = allLines.slice(lastLudusCount)
            lastLudusCount = allLines.length
            for (const line of newLines) {
              send("LUDUS", line)
            }
          } else if (result.error) {
            send("ERROR", result.error)
            break
          }

          // ── Check range state + get rangeID for GOAD log path ─────────────
          const rangeQuery = rangeId ? `?rangeID=${rangeId}` : userId ? `?userID=${userId}` : ""
          const rangeResult = await ludusGet<{ rangeState: string; rangeID?: string }>(
            `/range${rangeQuery}`,
            { apiKey: effectiveApiKey }
          )
          const state = rangeResult.data?.rangeState
          if (!rangeId && rangeResult.data?.rangeID) {
            rangeId = rangeResult.data.rangeID
          }

          // ── GOAD ansible logs (SSH) ─────────────────────────────────────────
          if (rangeId) {
            const goadResult = await readGoadLog(settings, rangeId, lastGoadCount)
            lastGoadCount = goadResult.newCount
            for (const line of goadResult.lines) {
              send("GOAD", line)
            }
          }

          // ── Termination logic ──────────────────────────────────────────────
          if (state === "DEPLOYING" || state === "WAITING") {
            wasDeploying = true
            warmupRemaining = WARMUP_POLLS  // reset warmup every time we see DEPLOYING
          } else if (state) {
            // Not deploying — decide whether to keep waiting or exit
            if (wasDeploying) {
              // We saw DEPLOYING earlier and it has now finished — done
              send("LUDUS", `[DEPLOY_COMPLETE] Range state: ${state}`)
              break
            }
            if (state === "ERROR" || state === "ABORTED") {
              // Hard failure — exit immediately
              send("LUDUS", `[DEPLOY_COMPLETE] Range state: ${state}`)
              break
            }
            // Still warming up (operation hasn't started yet)
            warmupRemaining--
            if (warmupRemaining <= 0) {
              // Gave up waiting for the operation to begin
              send("LUDUS", `[DEPLOY_COMPLETE] Range state: ${state}`)
              break
            }
          }

          await new Promise((r) => setTimeout(r, 2000))
        }
      } catch (err) {
        controller.enqueue(
          encoder.encode(`data: [ERROR] Stream error: ${(err as Error).message}\n\n`)
        )
      } finally {
        controller.close()
      }
    },
    cancel() {},
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}
