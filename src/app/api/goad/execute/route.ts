import { NextRequest } from "next/server"
import { resolveAdminImpersonationFromRequest } from "@/lib/admin-impersonation-request"
import { streamGoadCommand, isGoadConfigured, readGoadRangeId } from "@/lib/goad-ssh"
import { createTask, appendLine, completeTask, abortTask } from "@/lib/goad-task-store"
import { resolveSession } from "@/lib/session"
import { getSettings } from "@/lib/settings-store"
import { rootPasswordCredsIfSet } from "@/lib/root-ssh-auth"
import { registerCleanup, deregisterCleanup, invokeCleanup } from "@/lib/task-cleanup-registry"
import { refreshLudusWallClockFromSsh } from "@/lib/ludus-wall-clock"
import { filterLudusDeployTags } from "@/lib/ludus-deploy-tags"
import { clientIpFromRequest } from "@/lib/security-audit-log"
import { logAppEvent } from "@/lib/app-log"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  if (!isGoadConfigured()) {
    return new Response(
      "data: [ERROR] GOAD SSH not configured. Set LUDUS_SSH_HOST in your environment.\n\n",
      {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      }
    )
  }

  const body = await request.json().catch(() => ({ args: "", instanceId: undefined }))
  const { args, instanceId, impersonateAs, rangeId: bodyRangeId, ludusDeployTags: rawDeployTags } = body as {
    args?: string
    instanceId?: string
    /** apiKey is optional: when absent, the session cookie's impersonation key is used. */
    impersonateAs?: { username: string; apiKey?: string }
    /** Explicit rangeID to target — passed by the caller when a dedicated range
     *  is known up-front (e.g. new-instance flow where the range was pre-created). */
    rangeId?: string
    ludusDeployTags?: unknown
  }

  const ludusDeployTags =
    Array.isArray(rawDeployTags) && rawDeployTags.every((x) => typeof x === "string")
      ? filterLudusDeployTags(rawDeployTags as string[])
      : []

  if (!args) {
    return new Response("data: [ERROR] No command args provided\n\n", {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    })
  }

  const session = await resolveSession(request)

  if (!session) {
    return new Response("data: [ERROR] Not authenticated\n\n", {
      status: 401,
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    })
  }

  // Impersonation: admin SSHes as root and runs commands via sudo.
  // Verify the caller is an admin before allowing impersonation.
  if (impersonateAs && !session.isAdmin) {
    return new Response("data: [ERROR] Admin session required for impersonation\n\n", {
      status: 403,
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    })
  }

  // Defense-in-depth: check whether the session cookie carries an active
  // impersonation (set by /api/auth/impersonate POST).  This is the authoritative
  // source for the impersonation API key — the body's impersonateAs.apiKey is
  // omitted now that the client no longer stores apiKey in sessionStorage.
  const imp = resolveAdminImpersonationFromRequest(session, request)
  const sshUser = (imp.sshLogin || imp.ludusPrincipal || "").trim()
  const sessionImpersonate =
    session.isAdmin && imp.apiKey && sshUser
      ? { username: sshUser, apiKey: imp.apiKey }
      : null

  // Merge body impersonation with cookie:
  //   - If body has both username + apiKey, use as-is (legacy callers).
  //   - If body has only username (apiKey stripped — no longer stored client-side),
  //     take the apiKey from the session cookie's impersonation state.
  //   - If no body impersonation at all, use the session cookie impersonation.
  const effectiveImpersonate = (() => {
    if (!impersonateAs) return sessionImpersonate
    if (impersonateAs.apiKey) return { username: impersonateAs.username, apiKey: impersonateAs.apiKey }
    // Body has username but no apiKey — fall back to cookie apiKey for this user.
    // If the cookie doesn't have an apiKey either, drop impersonation rather than
    // constructing an object with null apiKey (which would fail downstream type checks).
    const cookieApiKey = sessionImpersonate?.apiKey
    if (!cookieApiKey) return sessionImpersonate
    // Cookie carries POSIX sshLogin; UI may send Ludus principal in the body — keep sudo identity from cookie.
    const sudoIdentity =
      sessionImpersonate.username.trim() || impersonateAs.username.trim()
    return { username: sudoIdentity, apiKey: cookieApiKey }
  })()

  // ── Determine the rangeId to inject as LUDUS_RANGE_ID ────────────────────
  // Priority: 1) explicit in request body (client passes instance.ludusRangeId)
  //           2) read from .goad_range_id file in workspace (existing instance)
  //           3) omit — no range scoping (falls back to user's default range)
  //
  // Note: we intentionally read the .goad_range_id file even when impersonating.
  //       The previous guard (!impersonateAs) meant impersonated destroy/start/stop
  //       commands never received range scoping, causing them to target the wrong
  //       (default) range.
  let effectiveRangeId: string | undefined = bodyRangeId || undefined
  if (!effectiveRangeId && instanceId) {
    try {
      const settings = getSettings()
      const rootCreds = rootPasswordCredsIfSet(settings)
      effectiveRangeId = (await readGoadRangeId(instanceId, rootCreds)) ?? undefined
    } catch {
      // SSH unavailable — proceed without range targeting
    }
  }

  // Use the impersonated user's API key as LUDUS_API_KEY when impersonating,
  // so GOAD's `ludus` calls are authenticated as the correct user.
  const apiKey = (effectiveImpersonate?.apiKey || session?.apiKey) ?? null

  // Use the session's own credentials so GOAD runs as the logged-in user,
  // using their personal LUDUS_API_KEY and their own GOAD workspace.
  // When impersonating, creds are ignored — root SSH + sudo handles auth.
  const creds = (!effectiveImpersonate && session?.sshPassword)
    ? { username: session.username, password: session.sshPassword }
    : undefined

  // Task is attributed to the impersonated user so it appears in their history
  const taskOwner = effectiveImpersonate?.username ?? session?.username
  const taskId = createTask(args, instanceId, taskOwner, apiKey ?? undefined)
  logAppEvent("goad_execute", `task=${taskId} instance=${instanceId ?? "none"}`, {
    username: session.username,
    ip: clientIpFromRequest(request),
    outcome: "success",
  })
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      // Prime Ludus-host wall clock cache so GOAD log line timestamps match Range Logs.
      await refreshLudusWallClockFromSsh()

      let lineSerial = 0
      const send = (line: string) => {
        lineSerial++
        if (lineSerial % 32 === 0) void refreshLudusWallClockFromSsh()
        const out = appendLine(taskId, line)
        if (out != null) {
          try { controller.enqueue(encoder.encode(`data: ${out}\n\n`)) } catch {}
        }
      }

      // Emit task ID first so the client can resume after navigation
      try { controller.enqueue(encoder.encode(`data: [TASKID] ${taskId}\n\n`)) } catch {}

      let cleanup: (() => void) | undefined

      const closePromise = new Promise<void>((resolve) => {
        streamGoadCommand(
          args,
          apiKey,
          (line) => { send(line) },
          (code) => {
            deregisterCleanup(taskId)
            completeTask(taskId, code, code === 0 ? "completed" : "error")
            send(`[EXIT] Command exited with code ${code}`)
            try { controller.close() } catch {}
            resolve()
          },
          (err) => {
            deregisterCleanup(taskId)
            completeTask(taskId, -1, "error")
            send(`[ERROR] ${err.message}`)
            try { controller.close() } catch {}
            resolve()
          },
          creds,
          effectiveImpersonate ?? undefined,
          effectiveRangeId,
          ludusDeployTags.length > 0 ? ludusDeployTags : undefined
        ).then((fn) => {
          cleanup = fn
          // Register so the /stop endpoint can kill the process even after
          // the SSE client disconnects (sign-out, navigation, etc.)
          registerCleanup(taskId, fn)
        })
      })

      request.signal.addEventListener("abort", () => {
        // Client disconnected (navigated away / closed tab).
        // Intentionally do NOT kill the SSH/ansible process — let it keep running.
        // Lines continue to flow into appendLine/goad-task-store so the task
        // completes normally.  The user can reconnect via resumeTask(taskId) on
        // the instance page (useGoadStream reads the persisted taskId from
        // sessionStorage and calls /api/goad/tasks/${id}/stream on mount).
        try { controller.close() } catch {}
      })

      await closePromise
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}
