/**
 * Ludus DELETE /user runs Ansible (e.g. del-user.yml) which calls userdel(8).
 * Common failure: "user is currently used by process" when SSH/GOAD still runs as that uid.
 */

const MAX_SNIPPET = 900

function truncateSnippet(s: string, max = MAX_SNIPPET): string {
  const t = s.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

export function formatLudusUserDeleteError(raw: string, userId: string): { title: string; description: string } {
  const blob = typeof raw === "string" ? raw : String(raw)
  const lower = blob.toLowerCase()

  const inUse =
    lower.includes("userdel") &&
    (lower.includes("currently used") ||
      lower.includes("used by process") ||
      /account.*in use/.test(lower))

  if (inUse) {
    return {
      title: "User still has processes on the Ludus host",
      description:
        `${userId}: Linux refused userdel — a process still runs under this account (often an open SSH session on the Ludus server, or GOAD/Ansible). Log out that user from the host, stop their jobs, then delete again. Abbreviated server output: ${truncateSnippet(blob)}`,
    }
  }

  return {
    title: "Error deleting user",
    description: `${userId}: ${truncateSnippet(blob, 2000)}`,
  }
}
