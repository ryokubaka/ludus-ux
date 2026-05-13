import { NextRequest } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { resolveAdminImpersonationFromRequest } from "@/lib/admin-impersonation-request"
import { ludusGet, ludusRequest } from "@/lib/ludus-client"
import { getSettings } from "@/lib/settings-store"
import { sshExec } from "@/lib/proxmox-ssh"
import { isRootProxmoxSshConfigured } from "@/lib/root-ssh-auth"
import { refreshLudusWallClockFromSsh } from "@/lib/ludus-wall-clock"
import { getCachedLudusWallHmsOrUtc } from "@/lib/ludus-wall-clock-bridge"
import { createDeployLogDedupe } from "@/lib/deploy-log-sse-dedupe"
import {
  augmentLudusDeployHistoryLines,
  deployLogLineHasLeadingWallTimestamp,
} from "@/lib/log-line-timestamp"

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

  // Use the impersonated user's API key when an admin is impersonating; falls
  // back to the session's own key. Both apiKey and userId from cookie.
  const { apiKey: impersonateApiKey } = resolveAdminImpersonationFromRequest(session, request)
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

      const sendLudusOrGoadLine = (prefix: "LUDUS" | "GOAD", line: string, stamp: string) => {
        try {
          const t = line.trimStart()
          const payload = deployLogLineHasLeadingWallTimestamp(line)
            ? `[${prefix}] ${line}`
            : `[${prefix}] [${stamp}] ${line}`
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`))
        } catch {
          /* controller closed */
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
        /** Require consecutive polls not deploying before [DONE] (avoids one-poll flicker mid-GOAD). */
        let nonDeployingAfterWasDeploying = 0
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
          }
        }

        while (maxPolls-- > 0) {
          pollIdx++
          if (request.signal.aborted) {
            await tryEmitTerminalDone("request-aborted")
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
              let ludusEmit = newLines
              if (
                newLines.length > 1 &&
                newLines.every((l) => !deployLogLineHasLeadingWallTimestamp(l))
              ) {
                const t1 = Date.now()
                const t0 = t1 - Math.min(6 * 60 * 60 * 1000, Math.max(60_000, newLines.length * 2000))
                ludusEmit = augmentLudusDeployHistoryLines(
                  newLines,
                  new Date(t0).toISOString(),
                  new Date(t1).toISOString(),
                )
              }
              for (let i = 0; i < ludusEmit.length; i++) {
                const out = ludusEmit[i]
                sendLudusOrGoadLine("LUDUS", out, pollStamp)
                deployDedupe.remember(newLines[i] ?? out)
              }
              if (newLines.length > 0) lastActivityAt = Date.now()
            }
          } else if (result.error) {
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
                sendLudusOrGoadLine("GOAD", line, pollStamp)
                deployDedupe.remember(line)
              }
            }
            if (!skipGoadBackfill && goadResult.lines.length > 0) lastActivityAt = Date.now()
          }

          // ── Termination logic ──────────────────────────────────────────────
          if (state === "DEPLOYING" || state === "WAITING") {
            wasDeploying = true
            nonDeployingAfterWasDeploying = 0
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
              send("DONE", state, pollStamp)
              streamDone = true
              break
            }
          } else if (state) {
            if (wasDeploying) {
              nonDeployingAfterWasDeploying++
              if (nonDeployingAfterWasDeploying >= 2) {
                send("DONE", state, pollStamp)
                streamDone = true
                break
              }
            } else {
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
              send("DONE", state, pollStamp)
              streamDone = true
              break
            }
            warmupRemaining--
            if (warmupRemaining <= 0) {
              send("DONE", state, pollStamp)
              streamDone = true
              break
            }
            }
          }

          await new Promise((r) => setTimeout(r, 2000))
        }
        await tryEmitTerminalDone("after-loop")
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
