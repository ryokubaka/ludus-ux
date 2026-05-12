import { NextRequest } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { ludusGet, ludusRequest } from "@/lib/ludus-client"
import { getSettings } from "@/lib/settings-store"
import { sshExec } from "@/lib/proxmox-ssh"
import { isRootProxmoxSshConfigured } from "@/lib/root-ssh-auth"
import { refreshLudusWallClockFromSsh } from "@/lib/ludus-wall-clock"
import { getCachedLudusWallHmsOrUtc } from "@/lib/ludus-wall-clock-bridge"
import { debugAgentLogServer } from "@/lib/debug-agent-log-server"
import { createDeployLogDedupe } from "@/lib/deploy-log-sse-dedupe"

export const dynamic = "force-dynamic"

/** Read the GOAD ansible log (SSH-based). Returns new lines since lastLineCount. */
async function readGoadLog(
  settings: ReturnType<typeof getSettings>,
  rangeId: string,
  lastCount: number,
): Promise<{ lines: string[]; newCount: number }> {
  if (!settings.sshHost || !isRootProxmoxSshConfigured(settings)) return { lines: [], newCount: lastCount }
  try {
    // Ludus v2 stores range files under /opt/ludus/ranges/<rangeID>/
    const logPath = `/opt/ludus/ranges/${rangeId}/ansible.log`
    const content = await sshExec(
      settings.sshHost, settings.sshPort,
      settings.proxmoxSshUser || "root", settings.proxmoxSshPassword || "",
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
  // When true, skip all log lines that already exist at stream-open time so
  // only NEW lines (written after the client connected) are emitted.
  // Used by allow/deny operations to avoid flooding the panel with stale
  // deployment logs from a previous range deploy.
  const snapshotStart = searchParams.get("snapshotStart") === "true"
  const settings = getSettings()

  // Support admin impersonation: use the impersonated user's API key
  const impersonateApiKey = session.isAdmin
    ? request.headers.get("X-Impersonate-Apikey") || null
    : null
  const effectiveApiKey = impersonateApiKey || session.apiKey

  const stream = new ReadableStream({
    async start(controller) {
      const send = (prefix: string, data: string, stamp: string) => {
        try {
          // Prepend a timestamp to human-readable log lines; leave control
          // messages (STATE / DONE / ERROR) unmodified so the client can parse them.
          // Stamp uses Ludus-host POSIX instant when SSH `date +%s` succeeded this poll,
          // formatted in `process.env.TZ` (default America/New_York).
          const payload = (prefix === "LUDUS" || prefix === "GOAD")
            ? `[${prefix}] [${stamp}] ${data}`
            : `[${prefix}] ${data}`
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`))
        } catch {
          // Controller already closed (client disconnected)
        }
      }

      try {
        let lastLudusCount = 0
        let lastGoadCount = 0
        let firstPoll = true
        let rangeId = rangeIdParam || ""
        let maxPolls = 900  // 30 min hard ceiling
        let pollIdx = 0
        let streamDone = false

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

        // Idle-timeout: Ludus can get stuck in DEPLOYING when its internal
        // goroutine exits without updating PocketBase (e.g. after an Ansible
        // failure on a Windows VM).  Without this guard the stream would run
        // for the full 30 min ceiling with no useful output.
        // We track the wall-clock time of the last new log line and emit
        // [DONE] <state> once no activity has been seen for IDLE_TIMEOUT_MS.
        // 10 min covers Windows reboot quiet periods while still giving timely
        // feedback when a deployment is genuinely stuck.
        const IDLE_TIMEOUT_MS = 10 * 60 * 1000
        let lastActivityAt = Date.now()
        const deployDedupe = createDeployLogDedupe()

        /** Client may abort SSE (new stream, navigation) before next poll sees SUCCESS. */
        const tryEmitTerminalDone = async (reason: string) => {
          if (streamDone || !wasDeploying || !rangeId) return
          const rangeQuery = `?rangeID=${encodeURIComponent(rangeId)}`
          const snapshot = getCachedLudusWallHmsOrUtc()
          const fr = await ludusGet<{ rangeState: string }>(`/range${rangeQuery}`, { apiKey: effectiveApiKey })
          const s = fr.data?.rangeState
          if (s && s !== "DEPLOYING" && s !== "WAITING") {
            send("DONE", s, snapshot)
            streamDone = true
            // #region agent log
            debugAgentLogServer({
              hypothesisId: "H1",
              location: "logs/stream/route.ts:tryEmitTerminalDone",
              message: "deploy sse reconciled terminal DONE",
              data: { reason, state: s, rangeId },
              runId: "post-fix",
            })
            // #endregion
          }
        }

        while (maxPolls-- > 0) {
          pollIdx++
          if (request.signal.aborted) {
            await tryEmitTerminalDone("request-aborted")
            // #region agent log
            debugAgentLogServer({
              hypothesisId: "H4",
              location: "logs/stream/route.ts:loop",
              message: "deploy sse request.signal aborted (after reconcile)",
              data: { rangeId: rangeId || null, pollIdx, lastEmittedState, streamDone },
              runId: "post-fix",
            })
            // #endregion
            break
          }

          await refreshLudusWallClockFromSsh()
          const pollStamp = getCachedLudusWallHmsOrUtc()

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

            if (firstPoll && snapshotStart) {
              // Skip all pre-existing lines — only stream new content from here on.
              // This prevents allow/deny operations from flooding the panel with
              // stale deployment logs that were written before this stream opened.
              firstPoll = false
            } else {
              firstPoll = false
              for (const line of newLines) {
                send("LUDUS", line, pollStamp)
                deployDedupe.remember(line)
              }
              if (newLines.length > 0) lastActivityAt = Date.now()
            }
          } else if (result.error) {
            // #region agent log
            debugAgentLogServer({
              hypothesisId: "H4",
              location: "logs/stream/route.ts:ludusLogs",
              message: "ludus /range/logs error break",
              data: {
                pollIdx,
                errLen: result.error.length,
                errHead: result.error.slice(0, 120),
                rangeId: rangeId || null,
              },
              runId: "pre-fix",
            })
            // #endregion
            send("ERROR", result.error, pollStamp)
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
            send("STATE", state, pollStamp)
            lastEmittedState = state
          }

          // ── GOAD ansible logs (SSH) ─────────────────────────────────────────
          if (rangeId) {
            const goadResult = await readGoadLog(settings, rangeId, lastGoadCount)
            lastGoadCount = goadResult.newCount
            const skipGoadBackfill = snapshotStart && pollIdx === 1
            if (!skipGoadBackfill) {
              for (const line of goadResult.lines) {
                if (deployDedupe.isDuplicate(line)) continue
                send("GOAD", line, pollStamp)
                deployDedupe.remember(line)
              }
            }
            if (!skipGoadBackfill && goadResult.lines.length > 0) lastActivityAt = Date.now()
          }

          if (pollIdx % 15 === 0) {
            // #region agent log
            debugAgentLogServer({
              hypothesisId: "H2-H3",
              location: "logs/stream/route.ts:pollSnapshot",
              message: "deploy sse poll snapshot",
              data: {
                pollIdx,
                state: state ?? null,
                wasDeploying,
                lastEmittedState,
                rangeId: rangeId || null,
                idleSec: Math.round((Date.now() - lastActivityAt) / 1000),
                maxPollsRemaining: maxPolls,
                lastLudusCount,
                lastGoadCount,
              },
              runId: "pre-fix",
            })
            // #endregion
          }

          // ── Termination logic ──────────────────────────────────────────────
          if (state === "DEPLOYING" || state === "WAITING") {
            wasDeploying = true
            warmupRemaining = WARMUP_POLLS  // reset warmup every time we see DEPLOYING

            // Idle timeout: if no new log lines have arrived for IDLE_TIMEOUT_MS
            // while the range is stuck in DEPLOYING, attempt a server-side abort
            // before closing the stream so the PocketBase state gets updated.
            if (Date.now() - lastActivityAt > IDLE_TIMEOUT_MS) {
              // Try aborting with user key first, then root key if available
              try {
                const abortResult = await ludusRequest(
                  `/range/abort?rangeID=${encodeURIComponent(rangeId)}`,
                  { method: "POST", apiKey: effectiveApiKey }
                )
                if (!abortResult.data && settings.rootApiKey) {
                  await ludusRequest(
                    `/range/abort?rangeID=${encodeURIComponent(rangeId)}`,
                    { method: "POST", apiKey: settings.rootApiKey, useAdminEndpoint: true }
                  )
                }
              } catch { /* best-effort */ }
              // #region agent log
              debugAgentLogServer({
                hypothesisId: "H3",
                location: "logs/stream/route.ts:idleTimeout",
                message: "deploy sse DONE idle-timeout while deploying",
                data: {
                  state,
                  wasDeploying,
                  pollIdx,
                  idleSec: Math.round((Date.now() - lastActivityAt) / 1000),
                  rangeId: rangeId || null,
                },
                runId: "pre-fix",
              })
              // #endregion
              send("DONE", state, pollStamp)
              streamDone = true
              break
            }
          } else if (state) {
            // Not deploying — decide whether to keep waiting or exit
            if (wasDeploying) {
              // We saw DEPLOYING earlier and it has now finished — done
              // #region agent log
              debugAgentLogServer({
                hypothesisId: "H1-H2",
                location: "logs/stream/route.ts:wasDeployingDone",
                message: "deploy sse DONE after wasDeploying",
                data: { state, pollIdx, rangeId: rangeId || null },
                runId: "pre-fix",
              })
              // #endregion
              send("DONE", state, pollStamp)
              streamDone = true
              break
            }
            // During warmup we intentionally do NOT exit immediately on ERROR/ABORTED.
            // GOAD deployments leave the range in ERROR (empty, no VMs) for several
            // minutes while it sets up the workspace and before `ludus range deploy`
            // starts.  Exiting early here would kill the stream before any useful
            // logs arrive.  We just count down the warmup and give up only if
            // DEPLOYING never appears within the window.
            //
            // Exception: testing-mode ops (snapshot/revert) never enter DEPLOYING.
            // Once at least 10 s have elapsed since stream start and no log activity
            // has been seen for 3 min, close the stream rather than waiting the full
            // 5-min warmup.  This gives the UI timely "Done" feedback after the
            // Proxmox jobs finish without cutting off GOAD's long pre-DEPLOYING phase.
            const idleMs = Date.now() - lastActivityAt
            const elapsed = (WARMUP_POLLS - warmupRemaining) * 2000
            if (elapsed > 10_000 && idleMs > 3 * 60_000) {
              // #region agent log
              debugAgentLogServer({
                hypothesisId: "H1",
                location: "logs/stream/route.ts:warmupIdleDone",
                message: "deploy sse DONE testing-mode idle",
                data: { state, pollIdx, elapsed, idleMs, rangeId: rangeId || null },
                runId: "pre-fix",
              })
              // #endregion
              send("DONE", state, pollStamp)
              streamDone = true
              break
            }
            warmupRemaining--
            if (warmupRemaining <= 0) {
              // Gave up waiting for the operation to begin
              // #region agent log
              debugAgentLogServer({
                hypothesisId: "H1",
                location: "logs/stream/route.ts:warmupExhausted",
                message: "deploy sse DONE warmup exhausted",
                data: { state, pollIdx, rangeId: rangeId || null },
                runId: "pre-fix",
              })
              // #endregion
              send("DONE", state, pollStamp)
              streamDone = true
              break
            }
          }

          await new Promise((r) => setTimeout(r, 2000))
        }
        await tryEmitTerminalDone("after-loop")
        // #region agent log
        if (!streamDone) {
          debugAgentLogServer({
            hypothesisId: "H1",
            location: "logs/stream/route.ts:afterLoop",
            message: "deploy sse loop ended without DONE path",
            data: {
              pollIdx,
              maxPollsRemaining: maxPolls,
              lastEmittedState,
              wasDeploying,
              rangeId: rangeId || null,
            },
            runId: "post-fix",
          })
        }
        // #endregion
      } catch (err) {
        send("ERROR", `Stream error: ${(err as Error).message}`, getCachedLudusWallHmsOrUtc())
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
