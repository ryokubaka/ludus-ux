/**
 * Logger — overrides console methods to prefix every line with an ISO-8601
 * timestamp.  Import once (side-effect) at the process entry point so all
 * subsequent console.{log,info,warn,error} calls from any module get timestamps.
 *
 * Output format:  [2026-03-30T14:23:01.456Z] [WARN] [pocketbase] …
 */

import { sanitizeLogArgument } from "../src/lib/log-safe"

const _log = console.log.bind(console)
const _info = console.info.bind(console)
const _warn = console.warn.bind(console)
const _error = console.error.bind(console)

function ts(): string {
  return new Date().toISOString()
}

function sanitizeLogArg(arg: unknown): unknown {
  if (typeof arg === "string") return sanitizeLogArgument(arg)
  if (arg instanceof Error) return sanitizeLogArgument(arg.stack || arg.message)
  return arg
}

function write(sink: (...args: unknown[]) => void, level: string, args: unknown[]): void {
  // logInfo/logWarn/logError pass a constant "%s" plus one already-sanitized line.
  if (args.length === 2 && args[0] === "%s" && typeof args[1] === "string") {
    sink(`[${ts()}] [${level}]`, sanitizeLogArgument(args[1]))
    return
  }
  sink(`[${ts()}] [${level}]`, ...args.map(sanitizeLogArg))
}

console.log = (...args: unknown[]) => write(_log, "INFO", args)
console.info = (...args: unknown[]) => write(_info, "INFO", args)
console.warn = (...args: unknown[]) => write(_warn, "WARN", args)
console.error = (...args: unknown[]) => write(_error, "ERROR", args)
