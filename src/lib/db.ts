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
 *     - Human-readable — `cat data/tasks/GOAD-smeowden/goad-xxxx.log` works directly
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
const DB_PATH = path.join(DATA_DIR, "ludus-ui.db")

let _db: BetterSqlite3.Database | null = null

export function getDb(): BetterSqlite3.Database {
  if (_db) return _db
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.mkdirSync(TASKS_LOG_DIR, { recursive: true })
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Sqlite = require("better-sqlite3") as typeof BetterSqlite3
  _db = new Sqlite(DB_PATH)
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

/** Absolute path to the database file. */
export function dbPath(): string {
  return DB_PATH
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
