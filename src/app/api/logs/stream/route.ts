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
      // HH:MM:SS wall-clock — close enough to when the Ansible task ran (within 2 s poll)
      const nowHMS = () => new Date().toISOString().slice(11, 19)

      const send = (prefix: string, data: string) => {
        try {
          // Prepend a timestamp to human-readable log lines; leave control
          // messages (STATE / DONE / ERROR) unmodified so the client can parse them.
          const payload = (prefix === "LUDUS" || prefix === "GOAD")
            ? `[${prefix}] [${nowHMS()}] ${data}`
            : `[${prefix}] ${data}`
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`))
        } catch {
          // Controller already closed (client disconnected)
        }
      }

      try {
        let lastLudusCount = 0
        let lastGoadCount = 0
        let rangeId = rangeIdParam || ""
        let maxPolls = 900  // 30 min max (GOAD installs can take 30–90 min but range deploy itself is ≤15 min)

        // Warmup: don't terminate just because the range isn't DEPLOYING yet on
        // the first few checks.  GOAD's install flow creates the workspace first
        // then runs `ludus range deploy` internally — the range may be in ERROR
        // (empty, no VMs) or SUCCESS for several minutes before transitioning to
        // DEPLOYING.  We allow up to WARMUP_POLLS iterations (each 2 s) before
        // giving up if DEPLOYING never appears.
        const WARMUP_POLLS = 150  // 5 min warmup window
        let warmupRemaining  = WARMUP_POLLS
        let wasDeploying     = false
        let lastEmittedState = ""

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

          // ── Emit state changes so the client doesn't need a separate poll ──
          if (state && state !== lastEmittedState) {
            send("STATE", state)
            lastEmittedState = state
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
              send("DONE", state)
              break
            }
            // During warmup we intentionally do NOT exit immediately on ERROR/ABORTED.
            // GOAD deployments leave the range in ERROR (empty, no VMs) for several
            // minutes while it sets up the workspace and before `ludus range deploy`
            // starts.  Exiting early here would kill the stream before any useful
            // logs arrive.  We just count down the warmup and give up only if
            // DEPLOYING never appears within the window.
            warmupRemaining--
            if (warmupRemaining <= 0) {
              // Gave up waiting for the operation to begin
              send("DONE", state)
              break
            }
          }

          await new Promise((r) => setTimeout(r, 2000))
        }
      } catch (err) {
        send("ERROR", `Stream error: ${(err as Error).message}`)
      } finally {
        try { controller.close() } catch { /* already closed */ }
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
