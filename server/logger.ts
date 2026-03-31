/**
 * Logger — overrides console methods to prefix every line with an ISO-8601
 * timestamp.  Import once (side-effect) at the process entry point so all
 * subsequent console.{log,info,warn,error} calls from any module get timestamps.
 *
 * Output format:  [2026-03-30T14:23:01.456Z] [WARN]  [pocketbase] …
 */

const _log   = console.log.bind(console)
const _info  = console.info.bind(console)
const _warn  = console.warn.bind(console)
const _error = console.error.bind(console)

function ts(): string {
  return new Date().toISOString()
}

console.log   = (...args: unknown[]) => _log(  `[${ts()}] [INFO] `, ...args)
console.info  = (...args: unknown[]) => _info( `[${ts()}] [INFO] `, ...args)
console.warn  = (...args: unknown[]) => _warn( `[${ts()}] [WARN] `, ...args)
console.error = (...args: unknown[]) => _error(`[${ts()}] [ERROR]`, ...args)
