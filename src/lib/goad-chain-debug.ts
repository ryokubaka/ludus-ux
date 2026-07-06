/**
 * Optional JSON lines to the browser console for tracing Ludus → GOAD → extension.
 * Enable with `NEXT_PUBLIC_LUX_GOAD_CHAIN_DEBUG=1` (client) and/or
 * `LUX_GOAD_CHAIN_DEBUG=1` (server bundles that read process.env at runtime).
 */
function chainDebugEnabled(): boolean {
  if (typeof process === "undefined") return false
  return (
    process.env.LUX_GOAD_CHAIN_DEBUG === "1" ||
    process.env.NEXT_PUBLIC_LUX_GOAD_CHAIN_DEBUG === "1"
  )
}

export function goadChainDebug(phase: string, data?: Record<string, unknown>): void {
  if (!chainDebugEnabled()) return
  const payload = { phase, ts: new Date().toISOString(), ...data }
  console.info("[LUX_GOAD_CHAIN]", JSON.stringify(payload))
}
