/**
 * Server-side registry mapping taskId → SSH cleanup function for active streams.
 *
 * Storing this here (module-level singleton in the Next.js server process) lets
 * the /api/goad/tasks/[taskId]/stop endpoint kill an in-flight ansible process
 * even when the original SSE client has already disconnected (e.g. after the
 * user signs out and back in, then resumes the task and clicks "Stop Command").
 */
const registry = new Map<string, () => void>()

export function registerCleanup(taskId: string, fn: () => void): void {
  registry.set(taskId, fn)
}

export function deregisterCleanup(taskId: string): void {
  registry.delete(taskId)
}

/** Calls the cleanup function for a task and removes it from the registry.
 *  Returns true if a cleanup was found and called, false otherwise. */
export function invokeCleanup(taskId: string): boolean {
  const fn = registry.get(taskId)
  if (!fn) return false
  registry.delete(taskId)
  try { fn() } catch {}
  return true
}
