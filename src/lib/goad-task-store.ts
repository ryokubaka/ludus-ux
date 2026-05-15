/**
 * Server-side GOAD task store.
 *
 * Architecture
 * ────────────
 * • SQLite (via db.ts) stores task METADATA: id, command, instance, user,
 *   status, timestamps, and a line count.  It does NOT store log content.
 *
 * • Log content is written to plain-text files in DATA_DIR/tasks/{taskId}.log
 *   via fs.appendFileSync — one line per call, terminated by \n.
 *   This is the same pattern used by PM2, Docker log drivers, and Loki:
 *   separate metadata (structured, queryable) from content (append-only files).
 *
 * • An in-memory Map<id, TaskEntry> provides:
 *     - The subscriber fan-out for live SSE streaming (inherently ephemeral)
 *     - A line buffer for running tasks so concurrent SSE clients see the same output
 *   On startup the map is populated with task METADATA from SQLite.
 *   Log lines for completed tasks are loaded lazily from the file on first subscribe.
 *
 * Retention
 * ─────────
 * MAX_TASKS controls how many tasks are kept.  When exceeded, the oldest task
 * is deleted from SQLite and its log file is removed.
 */

import fs from "fs"
import path from "path"
import { getDb, taskLogPath, legacyTaskLogPath, TASKS_LOG_DIR } from "./db"
import { prefixGoadTaskLogLineWithTimestamp } from "./log-line-timestamp"

export type TaskStatus = "running" | "completed" | "error" | "aborted"

export interface GoadTask {
  id: string
  command: string
  instanceId?: string
  username?: string
  /**
   * Ludus user API key from the session that started this GOAD task (same as log stream).
   * Ephemeral — not persisted to SQLite; used by reconcile for GET /range/logs when root key is not a valid Ludus X-API-KEY.
   */
  ludusApiKey?: string
  /** In-memory line buffer for running tasks; loaded lazily from file for completed ones. */
  lines: string[]
  /** Always accurate line count — read from DB for completed tasks, tracked in-memory for running. */
  lineCount: number
  status: TaskStatus
  startedAt: number
  endedAt?: number
  exitCode?: number
  /** Post-GOAD processing phase: "network-deploy" while firewall rules are redeploying, null otherwise. */
  phase?: "network-deploy" | null
  /** True when this task involved custom firewall rules requiring a network-tag redeploy. */
  hasNetworkRules?: boolean
}

type LineSubscriber = (line: string) => void
type CloseSubscriber = (exitCode: number | null) => void

interface TaskEntry {
  task: GoadTask
  lineSubscribers: Set<LineSubscriber>
  closeSubscribers: Set<CloseSubscriber>
  /** true once task.lines matches the full log file content */
  linesLoaded: boolean
}

const MAX_TASKS = 200

/** Last N lines only — full join on 50k+ line tasks blocked the event loop and reconcile never completed. */
const RECONCILE_LOG_TAIL_LINES = 25_000

const taskMap = new Map<string, TaskEntry>()
const taskOrder: string[] = []

// ── Startup hydration ─────────────────────────────────────────────────────────

function hydrateFromDb(): void {
  try {
    fs.mkdirSync(TASKS_LOG_DIR, { recursive: true })
    const db = getDb()
    type Row = {
      id: string
      command: string
      instance_id: string | null
      username: string | null
      status: string
      started_at: number
      ended_at: number | null
      exit_code: number | null
      line_count: number
      phase: string | null
      has_network_rules: number
      ludus_api_key: string | null
    }
    // Any task still marked "running" in the DB is stale — the process died with
    // the container. Mark them as "error" immediately so the UI doesn't spin forever.
    db.exec(
      `UPDATE goad_tasks SET status = 'error', exit_code = -1,
         ended_at = COALESCE(ended_at, ${Date.now()})
       WHERE status = 'running'`
    )

    const rows = db
      .prepare(
        `SELECT id, command, instance_id, username, status, started_at, ended_at, exit_code, line_count, phase, has_network_rules, ludus_api_key
         FROM goad_tasks
         ORDER BY started_at ASC
         LIMIT ?`
      )
      .all(MAX_TASKS) as Row[]

    for (const row of rows) {
      const task: GoadTask = {
        id: row.id,
        command: row.command,
        instanceId: row.instance_id ?? undefined,
        username: row.username ?? undefined,
        ludusApiKey: row.ludus_api_key ?? undefined,
        status: row.status as TaskStatus,
        startedAt: row.started_at,
        endedAt: row.ended_at ?? undefined,
        exitCode: row.exit_code ?? undefined,
        lines: [],
        lineCount: row.line_count,
        phase: (row.phase as "network-deploy" | null) ?? null,
        hasNetworkRules: row.has_network_rules === 1,
      }
      taskMap.set(row.id, {
        task,
        lineSubscribers: new Set(),
        closeSubscribers: new Set(),
        linesLoaded: false,
      })
      taskOrder.push(row.id)
    }

    // Recover orphaned log files whose DB record was lost (e.g. container SIGKILL
    // before WAL checkpoint, or a migration that wiped the table).
    // Scans both the new per-instance subdirectory layout AND the legacy flat layout.
    try {
      type LogEntry = { logPath: string; instanceId: string | null }
      const logEntries: LogEntry[] = []

      for (const entry of fs.readdirSync(TASKS_LOG_DIR, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          // New layout: tasks/{instanceId}/*.log  (_global dir maps to null instanceId)
          const subdir = path.join(TASKS_LOG_DIR, entry.name)
          const subInstanceId = entry.name === "_global" ? null : entry.name
          try {
            for (const sub of fs.readdirSync(subdir, { withFileTypes: true })) {
              if (!sub.isDirectory() && sub.name.endsWith(".log")) {
                logEntries.push({ logPath: path.join(subdir, sub.name), instanceId: subInstanceId })
              }
            }
          } catch {}
        } else if (entry.name.endsWith(".log")) {
          // Legacy layout: tasks/{taskId}.log (no instanceId info in path)
          logEntries.push({ logPath: path.join(TASKS_LOG_DIR, entry.name), instanceId: null })
        }
      }

      for (const { logPath, instanceId } of logEntries) {
        const taskId = path.basename(logPath, ".log")
        if (taskMap.has(taskId)) continue

        const stat = fs.statSync(logPath)
        const match = taskId.match(/^goad-(\d+)-/)
        const startedAt = match ? parseInt(match[1], 10) : Math.floor(stat.birthtimeMs)
        const endedAt = Math.floor(stat.mtimeMs)

        let lineCount = 0
        try {
          const content = fs.readFileSync(logPath, "utf8")
          lineCount = content.split("\n").filter((l) => l.length > 0).length
        } catch {}

        // Persist the recovered record so it survives future restarts.
        try {
          db.prepare(
            `INSERT OR IGNORE INTO goad_tasks
               (id, command, instance_id, username, status, started_at, ended_at, exit_code, line_count)
             VALUES (?, ?, ?, NULL, 'error', ?, ?, -1, ?)`
          ).run(taskId, "recovered — container restarted mid-task", instanceId ?? null, startedAt, endedAt, lineCount)
        } catch {}

        const task: GoadTask = {
          id: taskId,
          command: "recovered — container restarted mid-task",
          instanceId: instanceId ?? undefined,
          status: "error",
          startedAt,
          endedAt,
          exitCode: -1,
          lines: [],
          lineCount,
        }
        taskMap.set(taskId, {
          task,
          lineSubscribers: new Set(),
          closeSubscribers: new Set(),
          linesLoaded: false,
        })
        taskOrder.push(taskId)
        console.info(`[task-store] recovered orphaned task ${taskId} (${lineCount} lines, instance: ${instanceId ?? "none"})`)
      }
    } catch (scanErr) {
      console.warn("[task-store] orphan scan failed:", scanErr)
    }
  } catch (err) {
    console.error("[task-store] hydration failed:", err)
  }
}

hydrateFromDb()

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Distinct on-disk locations a task log may live (migration + instance linking). */
function logFileCandidates(taskId: string, instanceId?: string | null): string[] {
  return [
    ...new Set([
      legacyTaskLogPath(taskId),
      taskLogPath(taskId, null),
      taskLogPath(taskId, instanceId),
    ]),
  ]
}

function loadLinesFromFile(entry: TaskEntry): void {
  if (entry.linesLoaded) return
  try {
    const merged: string[] = []
    // Oldest layout first so a task that moved from flat → _global → per-instance
    // replays in chronological order when multiple files exist.
    for (const logFile of logFileCandidates(entry.task.id, entry.task.instanceId)) {
      if (!fs.existsSync(logFile)) continue
      const content = fs.readFileSync(logFile, "utf8")
      for (const line of content.split("\n")) {
        if (line.length > 0) merged.push(line)
      }
    }
    entry.task.lines = merged
    entry.task.lineCount = merged.length
  } catch (err) {
    console.error("[task-store] loadLines failed:", err)
  }
  entry.linesLoaded = true
}

function evictOldestIfNeeded(): void {
  while (taskOrder.length > MAX_TASKS) {
    const oldest = taskOrder.shift()!
    const entry = taskMap.get(oldest)
    taskMap.delete(oldest)
    try {
      getDb().prepare("DELETE FROM goad_tasks WHERE id = ?").run(oldest)
      for (const p of logFileCandidates(oldest, entry?.task.instanceId)) {
        if (fs.existsSync(p)) fs.unlinkSync(p)
      }
    } catch {}
  }
}

// ── Task lifecycle ────────────────────────────────────────────────────────────

export function createTask(
  command: string,
  instanceId?: string,
  username?: string,
  ludusApiKey?: string,
): string {
  const id = `goad-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const now = Date.now()
  const task: GoadTask = {
    id,
    command,
    instanceId,
    username,
    ludusApiKey: ludusApiKey?.trim() || undefined,
    lines: [],
    lineCount: 0,
    status: "running",
    startedAt: now,
  }

  try {
    getDb()
      .prepare(
        `INSERT INTO goad_tasks (id, command, instance_id, username, status, started_at, line_count, ludus_api_key)
         VALUES (?, ?, ?, ?, 'running', ?, 0, ?)`
      )
      .run(id, command, instanceId ?? null, username ?? null, now, task.ludusApiKey ?? null)
  } catch (err) {
    console.error("[task-store] createTask DB write failed:", err)
  }

  taskMap.set(id, {
    task,
    lineSubscribers: new Set(),
    closeSubscribers: new Set(),
    linesLoaded: true,
  })
  taskOrder.push(id)
  evictOldestIfNeeded()
  notifyTaskStatus(id, "running")
  return id
}

export function appendLine(taskId: string, line: string): string | undefined {
  const entry = taskMap.get(taskId)
  if (!entry) return undefined

  const stored = prefixGoadTaskLogLineWithTimestamp(line)
  entry.task.lines.push(stored)
  entry.task.lineCount++

  // Append to log file — O(1), no SQL overhead.
  // mkdirSync with recursive:true is a no-op if the directory already exists.
  try {
    const logFile = taskLogPath(taskId, entry.task.instanceId)
    fs.mkdirSync(path.dirname(logFile), { recursive: true })
    fs.appendFileSync(logFile, stored + "\n", "utf8")
  } catch (err) {
    console.error("[task-store] appendLine file write failed:", err)
  }

  // Periodically sync the line count to DB (every 50 lines) so restarts see accurate counts
  if (entry.task.lineCount % 50 === 0) {
    try {
      getDb()
        .prepare("UPDATE goad_tasks SET line_count = ? WHERE id = ?")
        .run(entry.task.lineCount, taskId)
    } catch {}
  }

  for (const sub of entry.lineSubscribers) {
    try { sub(stored) } catch {}
  }

  // GOAD can spin forever on "deployment in progress (DEPLOYING)" when Ansible
  // finished but Ludus never flipped PocketBase `rangeState`. Heuristic reconcile
  // runs every 6 log lines while running (was 12 — slower provide output + PB verify retries).
  if (entry.task.lineCount % 6 === 0 && entry.task.status === "running") {
    const lines = entry.task.lines
    const tail =
      lines.length <= RECONCILE_LOG_TAIL_LINES
        ? lines
        : lines.slice(-RECONCILE_LOG_TAIL_LINES)
    const snap = {
      taskId,
      instanceId: entry.task.instanceId,
      status: entry.task.status,
      logText: tail.join("\n"),
      ludusApiKey: entry.task.ludusApiKey,
    }
    void import("./goad-ludus-reconcile")
      .then((m) => m.tryReconcileStuckDeploySnapshot(snap))
      .catch(() => {})
  }

  return stored
}

export function completeTask(
  taskId: string,
  exitCode: number,
  status: TaskStatus = "completed"
): void {
  const entry = taskMap.get(taskId)
  if (!entry) return
  // Guard against late SSH channel-close events racing with an explicit Stop.
  // When the user hits Stop, abortTask() sets status → "aborted" first. The
  // underlying SSH stream then closes and calls completeTask again with "error".
  // Without this check the second call would silently overwrite "aborted" with
  // "error", making the UI show the wrong final state.
  if (entry.task.status !== "running") return
  const now = Date.now()
  entry.task.status = status
  entry.task.exitCode = exitCode
  entry.task.endedAt = now
  try {
    getDb()
      .prepare(
        "UPDATE goad_tasks SET status = ?, exit_code = ?, ended_at = ?, line_count = ? WHERE id = ?"
      )
      .run(status, exitCode, now, entry.task.lineCount, taskId)
  } catch (err) {
    console.error("[task-store] completeTask DB write failed:", err)
  }
  for (const sub of entry.closeSubscribers) {
    try { sub(exitCode) } catch {}
  }
  entry.lineSubscribers.clear()
  entry.closeSubscribers.clear()
  notifyTaskStatus(taskId, status)

  void import("@/lib/goad-pending-network-workflow")
    .then((m) =>
      m.runAfterGoadTaskCompleteIfNeeded({
        taskId,
        command: entry.task.command,
        exitCode,
        status,
        instanceId: entry.task.instanceId,
        username: entry.task.username ?? undefined,
        ludusApiKey: entry.task.ludusApiKey,
      }),
    )
    .catch((err) => console.error("[goad-task-store] pending-network workflow:", err))
}

export function abortTask(taskId: string): void {
  completeTask(taskId, -1, "aborted")
}

// ── Queries ───────────────────────────────────────────────────────────────────

export function getTask(taskId: string): GoadTask | null {
  const entry = taskMap.get(taskId)
  if (!entry) return null
  loadLinesFromFile(entry)
  return entry.task
}

/** Returns tasks newest-first, up to `limit`. */
export function listTasks(limit = MAX_TASKS): GoadTask[] {
  return taskOrder
    .slice(-limit)
    .reverse()
    .map((id) => taskMap.get(id)?.task)
    .filter(Boolean) as GoadTask[]
}

/**
 * Retroactively links a task to an instanceId.
 * Used after a "new instance" deployment where the instanceId was unknown at
 * task-creation time — once the instance is discovered, the caller updates the
 * record so it shows up correctly in the Logs History tab.
 */
export function updateTaskInstance(taskId: string, instanceId: string): boolean {
  const entry = taskMap.get(taskId)
  if (!entry) return false
  entry.task.instanceId = instanceId
  try {
    getDb().prepare("UPDATE goad_tasks SET instance_id = ? WHERE id = ?").run(instanceId, taskId)
  } catch (err) {
    console.error("[task-store] updateTaskInstance DB write failed:", err)
  }
  return true
}

/**
 * Update the post-GOAD processing phase on a task.
 * "network-deploy" = firewall rules are being redeployed; null = idle/done.
 */
export function updateTaskPhase(taskId: string, phase: "network-deploy" | null): void {
  const entry = taskMap.get(taskId)
  if (!entry) return
  entry.task.phase = phase
  try {
    getDb().prepare("UPDATE goad_tasks SET phase = ? WHERE id = ?").run(phase ?? null, taskId)
  } catch (err) {
    console.error("[task-store] updateTaskPhase DB write failed:", err)
  }
}

/**
 * Mark whether this task involved custom firewall rules requiring a network-tag redeploy.
 * Used by the dashboard to show a "Firewall rules redeploying" banner.
 */
export function setTaskHasNetworkRules(taskId: string, hasRules: boolean): void {
  const entry = taskMap.get(taskId)
  if (!entry) return
  entry.task.hasNetworkRules = hasRules
  try {
    getDb().prepare("UPDATE goad_tasks SET has_network_rules = ? WHERE id = ?").run(hasRules ? 1 : 0, taskId)
  } catch (err) {
    console.error("[task-store] setTaskHasNetworkRules DB write failed:", err)
  }
}

/** Returns the most recently-started task for a given instanceId, or null. */
export function getLatestTaskForInstance(instanceId: string): GoadTask | null {
  for (let i = taskOrder.length - 1; i >= 0; i--) {
    const task = taskMap.get(taskOrder[i])?.task
    if (task?.instanceId === instanceId) return task
  }
  return null
}

/**
 * Returns every task currently in `running` state for a given instanceId
 * (newest-first). Used by the unified abort route to kill any in-flight
 * GOAD SSH/ansible process before aborting the Ludus range.
 */
export function getRunningTasksForInstance(instanceId: string): GoadTask[] {
  const out: GoadTask[] = []
  for (let i = taskOrder.length - 1; i >= 0; i--) {
    const task = taskMap.get(taskOrder[i])?.task
    if (task && task.instanceId === instanceId && task.status === "running") {
      out.push(task)
    }
  }
  return out
}

// ── Global task status events (for lightweight SSE invalidation) ──────────────

type TaskStatusCallback = (taskId: string, status: TaskStatus) => void
const globalStatusSubscribers = new Set<TaskStatusCallback>()

/**
 * Subscribe to status changes for ALL tasks (creation + completion).
 * Returns an unsubscribe function. Used by the task-events SSE endpoint so
 * the task list page can invalidate its query without polling every 3 s.
 */
export function subscribeToTaskStatusEvents(cb: TaskStatusCallback): () => void {
  globalStatusSubscribers.add(cb)
  return () => globalStatusSubscribers.delete(cb)
}

function notifyTaskStatus(taskId: string, status: TaskStatus): void {
  for (const cb of globalStatusSubscribers) {
    try { cb(taskId, status) } catch {}
  }
}

// ── Subscription (for SSE replay + live stream) ───────────────────────────────

/**
 * Subscribe to a task's output.
 * Replays all existing lines (from log file if needed), then streams live lines.
 * Returns an unsubscribe function.
 */
export function subscribeToTask(
  taskId: string,
  onLine: LineSubscriber,
  onClose: CloseSubscriber
): () => void {
  const entry = taskMap.get(taskId)
  if (!entry) {
    onClose(null)
    return () => {}
  }

  loadLinesFromFile(entry)

  for (const line of entry.task.lines) {
    try { onLine(line) } catch {}
  }

  if (entry.task.status !== "running") {
    onClose(entry.task.exitCode ?? null)
    return () => {}
  }

  entry.lineSubscribers.add(onLine)
  entry.closeSubscribers.add(onClose)
  return () => {
    entry.lineSubscribers.delete(onLine)
    entry.closeSubscribers.delete(onClose)
  }
}
