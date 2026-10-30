/** Poll Ludus range `rangeState` until not in an in-flight deploy state. */

export type LudusRangeStatusPoll = () => Promise<{
  data?: { rangeState?: string }
  error?: unknown
}>

/** Default ceiling only stops infinite loops if Ludus never advances (deadlock / bug). */
export const LUDUS_WAIT_ABSOLUTE_MAX_MS = 24 * 60 * 60 * 1000

/**
 * Poll until `rangeState` is not `DEPLOYING` / `WAITING`, or `absoluteMaxMs`.
 * Primary exit is **state**, not duration: long GOAD + extension runs stay valid.
 *
 * @returns Uppercase terminal `rangeState`, or `undefined` on ceiling / empty reads.
 */
export async function waitUntilLudusRangeNotDeploying(
  poll: LudusRangeStatusPoll,
  options?: { pollMs?: number; absoluteMaxMs?: number },
): Promise<string | undefined> {
  const pollMs = options?.pollMs ?? 5_000
  const absoluteMaxMs = options?.absoluteMaxMs ?? LUDUS_WAIT_ABSOLUTE_MAX_MS
  const start = Date.now()
  /** Ludus sometimes returns no `rangeState` while work finished — do not spin until ceiling. */
  let emptyRsStreak = 0
  const emptyRsMax = Math.max(3, Math.ceil(45_000 / pollMs))

  while (Date.now() - start < absoluteMaxMs) {
    const st = await poll()
    const rs = String(st.data?.rangeState ?? "").trim().toUpperCase()
    if (rs && rs !== "DEPLOYING" && rs !== "WAITING") return rs
    if (!rs && !st.error) {
      emptyRsStreak++
      if (emptyRsStreak >= emptyRsMax) return undefined
    } else {
      emptyRsStreak = 0
    }
    await new Promise((r) => setTimeout(r, pollMs))
  }
  return undefined
}

/**
 * @deprecated Prefer {@link waitUntilLudusRangeNotDeploying} with an explicit ceiling.
 * @returns Uppercase terminal `rangeState`, or `undefined` on timeout / empty state.
 */
export async function waitUntilLudusRangeDeploySettled(
  poll: LudusRangeStatusPoll,
  options?: { pollMs?: number; timeoutMs?: number },
): Promise<string | undefined> {
  const timeoutMs = options?.timeoutMs ?? LUDUS_WAIT_ABSOLUTE_MAX_MS
  return waitUntilLudusRangeNotDeploying(poll, {
    pollMs: options?.pollMs ?? 5_000,
    absoluteMaxMs: timeoutMs,
  })
}
