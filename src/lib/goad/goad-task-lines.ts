/** Fetch stored GOAD task log lines (GET /api/goad/tasks/:id — owner/admin ACL). */
export async function fetchGoadTaskLogLines(
  taskId: string,
  headers?: Record<string, string>,
): Promise<string[]> {
  const res = await fetch(`/api/goad/tasks/${encodeURIComponent(taskId)}`, {
    credentials: "include",
    headers,
  })
  if (!res.ok) return []
  const task = (await res.json()) as { lines?: string[] }
  return Array.isArray(task.lines) ? task.lines : []
}
