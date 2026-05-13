/**
 * SQLite database singleton.
 *
 * The database file and task log files live under $DATA_DIR (default: <cwd>/data).
 * In Docker the directory is volume-mounted at /app/data for persistence.
 *
 * Architecture
 * ────────────
 * • SQLite stores structured metadata: task records, settings key-value pairs.
 *   It does NOT store log line content — that lives in flat files (see below).
 *
 * • Log content is stored as plain-text append-only files under DATA_DIR/tasks/.
 *   Files are organized by instance: `tasks/{instanceId}/{taskId}.log`.
 *   Tasks not associated with any instance use `tasks/_global/{taskId}.log`.
 *   Each line is terminated by \n.
 *   This mirrors how production log systems work (Loki, PM2, Docker log driver):
 *   metadata in a DB, content in files.  Benefits:
 *     - O(1) per-line write (fs.appendFileSync, no SQL overhead)
 *     - Human-readable — `cat data/tasks/GOAD-testuser/goad-xxxx.log` works directly
 *     - DB stays small; no row-per-line amplification
 *     - Files are trivially backed up or rotated independently per range
 *
 * Schema migrations
 * ─────────────────
 * schema_version has exactly one row (id = 1, CHECK enforced).
 * INSERT OR IGNORE is safe because the conflict key is `id`, not `version`,
 * so it never creates a phantom duplicate row even on repeated startups.
 */

import fs from "fs"
import path from "path"
import type BetterSqlite3 from "better-sqlite3"

export const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data")
export const TASKS_LOG_DIR = path.join(DATA_DIR, "tasks")
const DB_PATH = path.join(DATA_DIR, "ludus-ux.db")

let _db: BetterSqlite3.Database | null = null

/**
 * Next standalone can load better-sqlite3 JS from node_modules while `bindings`
 * resolves the addon relative to the wrong directory (/app/...). Loading the
 * .node by absolute path avoids that.
 */
function getNodeRequire(): NodeRequire {
  const nw = (globalThis as Record<string, unknown>)["__non_webpack_require__"]
  return typeof nw === "function" ? (nw as NodeRequire) : require
}

/**
 * Next standalone can load better-sqlite3 JS from node_modules while `bindings`
 * resolves the addon relative to the wrong directory (/app/...). Loading the
 * .node by absolute path avoids that.
 */
function resolveBetterSqlite3NativePath(): string | undefined {
  const req = getNodeRequire()
  let pkgDir: string
  try {
    pkgDir = path.dirname(req.resolve("better-sqlite3/package.json"))
  } catch {
    return undefined
  }
  const direct = [
    path.join(pkgDir, "build", "Release", "better_sqlite3.node"),
    path.join(pkgDir, "build", "Debug", "better_sqlite3.node"),
  ]
  for (const p of direct) {
    if (fs.existsSync(p)) return p
  }
  const bindingRoot = path.join(pkgDir, "lib", "binding")
  const walk = (dir: string, depth: number): string | undefined => {
    if (depth > 8) return undefined
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return undefined
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isFile() && e.name === "better_sqlite3.node") return full
      if (e.isDirectory()) {
        const hit = walk(full, depth + 1)
        if (hit) return hit
      }
    }
    return undefined
  }
  if (fs.existsSync(bindingRoot)) return walk(bindingRoot, 0)
  return undefined
}

export function getDb(): BetterSqlite3.Database {
  if (_db) return _db
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.mkdirSync(TASKS_LOG_DIR, { recursive: true })
  // better-sqlite3 is native; require() avoids ESM/CJS edge cases in Next server bundles
  const Sqlite = require("better-sqlite3") as typeof BetterSqlite3
  const nativePath = resolveBetterSqlite3NativePath()
  _db = new Sqlite(DB_PATH, nativePath ? { nativeBinding: nativePath } : {})
  _db.pragma("journal_mode = WAL")    // concurrent reads + crash-safe writes
  _db.pragma("foreign_keys = ON")
  _db.pragma("synchronous = NORMAL")  // safe with WAL, faster than FULL
  runMigrations(_db)
  // Belt-and-suspenders: ensure range_ops exists even if the migration system
  // hasn't caught up yet (e.g. first request to this route before any GOAD
  // route was hit and triggered the migration via goad-task-store hydration).
  _db.exec(`
    CREATE TABLE IF NOT EXISTS range_ops (
      id          TEXT    PRIMARY KEY,
      rangeId     TEXT    NOT NULL,
      username    TEXT    NOT NULL,
      opType      TEXT    NOT NULL,
      status      TEXT    NOT NULL DEFAULT 'pending',
      startedAt   INTEGER NOT NULL,
      completedAt INTEGER,
      expectedTestingEnabled INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_range_ops_lookup
      ON range_ops(rangeId, username, status, startedAt);
  `)
  return _db
}

/**
 * Absolute path to the log file for a given task.
 * Organized as: tasks/{instanceId}/{taskId}.log
 * Tasks without an instanceId go to:  tasks/_global/{taskId}.log
 */
export function taskLogPath(taskId: string, instanceId?: string | null): string {
  const subdir = instanceId ? instanceId : "_global"
  return path.join(TASKS_LOG_DIR, subdir, `${taskId}.log`)
}

/**
 * Legacy flat path used before per-instance directories were introduced.
 * Used only as a fallback when reading existing log files.
 */
export function legacyTaskLogPath(taskId: string): string {
  return path.join(TASKS_LOG_DIR, `${taskId}.log`)
}

// ── Migrations ────────────────────────────────────────────────────────────────

function runMigrations(db: BetterSqlite3.Database): void {
  // schema_version has exactly ONE row enforced by CHECK(id = 1).
  // INSERT OR IGNORE is keyed on `id`, never on `version`, so repeated
  // startups cannot create phantom duplicate rows.
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      id      INTEGER NOT NULL PRIMARY KEY DEFAULT 1 CHECK(id = 1),
      version INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO schema_version (id, version) VALUES (1, 0);
  `)

  // Repair any legacy broken state (two rows in schema_version from the old design)
  const rowCount = (db.prepare("SELECT COUNT(*) AS n FROM schema_version").get() as { n: number }).n
  if (rowCount > 1) {
    const maxVersion = (db.prepare("SELECT MAX(version) AS v FROM schema_version").get() as { v: number }).v
    db.exec("DELETE FROM schema_version")
    db.prepare("INSERT INTO schema_version (id, version) VALUES (1, ?)").run(maxVersion)
  }

  const { version: current } = db
    .prepare("SELECT version FROM schema_version WHERE id = 1")
    .get() as { version: number }

  const migrations: Array<(db: BetterSqlite3.Database) => void> = [
    // v1 — Initial schema: task metadata + settings
    (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS goad_tasks (
          id          TEXT    PRIMARY KEY,
          command     TEXT    NOT NULL,
          instance_id TEXT,
          username    TEXT,
          status      TEXT    NOT NULL DEFAULT 'running',
          started_at  INTEGER NOT NULL,
          ended_at    INTEGER,
          exit_code   INTEGER,
          line_count  INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_tasks_instance
          ON goad_tasks(instance_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_username
          ON goad_tasks(username);
        CREATE INDEX IF NOT EXISTS idx_tasks_started
          ON goad_tasks(started_at);

        CREATE TABLE IF NOT EXISTS settings (
          key        TEXT    PRIMARY KEY,
          value      TEXT    NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `)
    },

    // v2 — Drop the per-line table (content moved to flat log files)
    (db) => {
      db.exec("DROP TABLE IF EXISTS goad_task_lines")
    },

    // v3 — Range operation tracking (testing mode start/stop, etc.)
    // Persists server-side so the UI can show progress after page refreshes,
    // browser restarts, or container restarts (within the 30-min TTL).
    (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS range_ops (
          id          TEXT    PRIMARY KEY,
          rangeId     TEXT    NOT NULL,
          username    TEXT    NOT NULL,
          opType      TEXT    NOT NULL,   -- 'testing_start' | 'testing_stop'
          status      TEXT    NOT NULL DEFAULT 'pending',
                                          -- 'pending' | 'running' | 'completed' | 'error'
          startedAt   INTEGER NOT NULL,   -- ms epoch
          completedAt INTEGER,
          expectedTestingEnabled INTEGER NOT NULL DEFAULT 0
                                          -- 1 = expect enabled after op, 0 = expect disabled
        );
        CREATE INDEX IF NOT EXISTS idx_range_ops_lookup
          ON range_ops(rangeId, username, status, startedAt);
      `)
    },

    // v4 — Pending allow/deny tracking for testing-mode domains & IPs.
    // Replaces browser sessionStorage so state persists across logouts,
    // different browsers, and container restarts.
    (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS pending_allow_ops (
          id        INTEGER PRIMARY KEY AUTOINCREMENT,
          rangeId   TEXT    NOT NULL,
          username  TEXT    NOT NULL,
          entry     TEXT    NOT NULL,
          opType    TEXT    NOT NULL,
          createdAt INTEGER NOT NULL,
          UNIQUE(rangeId, username, entry, opType)
        );
        CREATE INDEX IF NOT EXISTS idx_pending_allow_lookup
          ON pending_allow_ops(rangeId, username);
      `)
    },

    // v5 — Range ownership overrides: admin-confirmed assignments that survive
    // container restarts even when Ludus API doesn't surface userID in responses.
    (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS range_ownership (
          rangeID     TEXT    NOT NULL PRIMARY KEY,
          userID      TEXT    NOT NULL,
          assignedBy  TEXT    NOT NULL DEFAULT 'admin',
          assignedAt  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_range_ownership_user
          ON range_ownership(userID);
      `)
    },

    // v6 — Local GOAD instance→range mapping.
    // Written by set-range whenever a new GOAD instance is created so that the
    // instances API can reliably return ludusRangeId without relying solely on
    // the SSH-written .goad_range_id file (which requires root SSH credentials).
    (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS goad_instance_ranges (
          instance_id TEXT    NOT NULL PRIMARY KEY,
          range_id    TEXT    NOT NULL,
          updated_at  INTEGER NOT NULL
        );
      `)
    },

    // v7 — Local audit log for Ludus VM destroys and GOAD extension removals (Ludus UX / LUX).
    (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS vm_operation_log (
          id              TEXT    PRIMARY KEY,
          ts              INTEGER NOT NULL,
          username        TEXT    NOT NULL,
          kind            TEXT    NOT NULL,
          range_id        TEXT,
          instance_id     TEXT,
          vm_id           INTEGER,
          vm_name         TEXT,
          extension_name  TEXT,
          status          TEXT    NOT NULL,
          detail          TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_vm_op_ts ON vm_operation_log(ts DESC);
        CREATE INDEX IF NOT EXISTS idx_vm_op_range ON vm_operation_log(range_id);
        CREATE INDEX IF NOT EXISTS idx_vm_op_instance ON vm_operation_log(instance_id);
      `)
    },

    // v8 — Deploy-queue phase tracking on GOAD tasks.
    // Replaces sessionStorage so deploy state is visible to all browsers and
    // impersonation sessions (same precedent as v4 pending_allow_ops).
    // phase: NULL = idle, "network-deploy" = post-GOAD firewall redeploy running
    // has_network_rules: 1 = this task involved custom firewall rules
    (db) => {
      db.exec(`
        ALTER TABLE goad_tasks ADD COLUMN phase TEXT;
        ALTER TABLE goad_tasks ADD COLUMN has_network_rules INTEGER NOT NULL DEFAULT 0;
      `)
    },

    // v9 — Durable LUX markers for Ludus range log history (testing toggle + deploy tags).
    (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS lux_range_testing_events (
          id            TEXT    PRIMARY KEY,
          range_id      TEXT    NOT NULL,
          username      TEXT    NOT NULL,
          op_type       TEXT    NOT NULL,
          range_op_id   TEXT,
          requested_at  INTEGER NOT NULL,
          completed_at  INTEGER NOT NULL,
          success       INTEGER NOT NULL DEFAULT 0,
          ludus_log_id  TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_lux_testing_range_user
          ON lux_range_testing_events(range_id, username, completed_at DESC);
        CREATE INDEX IF NOT EXISTS idx_lux_testing_ludus_id
          ON lux_range_testing_events(ludus_log_id);

        CREATE TABLE IF NOT EXISTS lux_range_deploy_tag_runs (
          id            TEXT    PRIMARY KEY,
          range_id      TEXT    NOT NULL,
          username      TEXT    NOT NULL,
          tags_csv      TEXT    NOT NULL,
          requested_at  INTEGER NOT NULL,
          ludus_log_id  TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_lux_deploy_tags_range_user
          ON lux_range_deploy_tag_runs(range_id, username, requested_at DESC);
        CREATE INDEX IF NOT EXISTS idx_lux_deploy_tags_ludus_id
          ON lux_range_deploy_tag_runs(ludus_log_id);
      `)
    },

    // v10 — Optional detail on testing events (allowlist domain/IP add/remove).
    (db) => {
      const cols = db.prepare("PRAGMA table_info(lux_range_testing_events)").all() as { name: string }[]
      if (!cols.some((c) => c.name === "detail")) {
        db.exec(`ALTER TABLE lux_range_testing_events ADD COLUMN detail TEXT`)
      }
    },

    // v11 — Durable deploy handoff state.
    //
    // Two changes:
    //   a) goad_tasks.ludus_api_key — persists the user's Ludus API key so the
    //      server-side pending-network workflow can make Ludus calls after a
    //      container restart (previously in-memory only, lost on restart).
    //      Stored in the same local SQLite DB that already holds task metadata;
    //      security boundary is equivalent to the DATA_DIR volume mount.
    //
    //   b) deploy_handoffs — captures wizard intent (rangeId, instanceId, pending
    //      network rules) before the GOAD execute call so the server can complete
    //      post-deploy linkage even if the user navigates away during deployment.
    //      Each handoff is linked to a task after execute returns the taskId.
    (db) => {
      const taskCols = db.prepare("PRAGMA table_info(goad_tasks)").all() as { name: string }[]
      if (!taskCols.some((c) => c.name === "ludus_api_key")) {
        db.exec(`ALTER TABLE goad_tasks ADD COLUMN ludus_api_key TEXT`)
      }
      db.exec(`
        CREATE TABLE IF NOT EXISTS deploy_handoffs (
          id                  TEXT    PRIMARY KEY,
          task_id             TEXT,
          instance_id         TEXT,
          range_id            TEXT    NOT NULL,
          username            TEXT    NOT NULL,
          network_rules_json  TEXT,
          created_at          INTEGER NOT NULL,
          linked_at           INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_deploy_handoffs_task
          ON deploy_handoffs(task_id);
        CREATE INDEX IF NOT EXISTS idx_deploy_handoffs_instance
          ON deploy_handoffs(instance_id);
      `)
    },
  ]

  for (let v = current; v < migrations.length; v++) {
    const run = db.transaction(() => {
      migrations[v](db)
      db.prepare("UPDATE schema_version SET version = ? WHERE id = 1").run(v + 1)
    })
    run()
    console.log(`[db] applied migration v${v + 1}`)
  }
}
