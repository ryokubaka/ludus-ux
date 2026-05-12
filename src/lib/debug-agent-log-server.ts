import fs from "fs"
import path from "path"
import { DATA_DIR } from "./db"

const INGEST = "http://127.0.0.1:7431/ingest/3a0c99c1-e8d2-401b-aa16-3dfe66e19e42"
const SESSION = "76ce71"
const REL = "debug-76ce71.log"

/** NDJSON + ingest (Docker: read `./data/debug-76ce71.log`). No secrets in payload. */
export function debugAgentLogServer(payload: Record<string, unknown>): void {
  const entry = { sessionId: SESSION, timestamp: Date.now(), ...payload }
  const line = `${JSON.stringify(entry)}\n`
  try {
    fs.appendFileSync(path.join(DATA_DIR, REL), line, "utf8")
  } catch {
    /* ignore */
  }
  fetch(INGEST, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": SESSION },
    body: JSON.stringify(entry),
  }).catch(() => {})
}
