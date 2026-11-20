const SECRET_LINE =
  /((?:ansible_password|ansible_become_password|ansible_ssh_pass|ansible_become_pass|password|passwd|secret|api[_-]?key)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|\S+)/gi

/** Hide inventory passwords before text is shown to the model or the page. */
export function redactSecrets(text: string): string {
  return text.replace(SECRET_LINE, "$1[redacted]")
}

export function scrubSecret(text: string, secret: string): string {
  const needle = secret.trim()
  if (needle.length < 8) return text
  return text.split(needle).join("[redacted]")
}

export function clipText(text: string, max: number): string {
  if (text.length <= max) return text
  let end = text.lastIndexOf("\n", max)
  if (end < max * 0.5) end = max
  const omitted = text.length - end
  return `${text.slice(0, end)}\n…[${omitted.toLocaleString("en-US")} characters omitted]`
}

export interface LabPasswordHit {
  host: string
  account: string
  password: string
}

/**
 * Pair ansible_user and ansible_password inside one inventory block.
 * A block ends at a blank line or the next INI group, so a group's vars
 * are not applied to the next group's account.
 */
export function findLabPassword(inventory: string, account: string): LabPasswordHit | null {
  const wanted = account.trim().toLowerCase()
  if (wanted.length < 2 || wanted.length > 64) return null
  for (const block of inventoryBlocks(inventory)) {
    const user = matchField(block, "ansible_user")
    if (!user || user.toLowerCase() !== wanted) continue
    const password = matchField(block, "ansible_password") || matchField(block, "ansible_ssh_pass")
    if (!password) continue
    const host = block.split(/\r?\n/)[0]?.trim().split(/\s+/)[0]?.replace(/:$/, "") || "host"
    return { host, account: user, password }
  }
  return null
}

function inventoryBlocks(inventory: string): string[] {
  const blocks: string[] = []
  let current: string[] = []
  const flush = () => {
    if (current.length > 0) blocks.push(current.join("\n"))
    current = []
  }
  for (const line of inventory.split(/\r?\n/)) {
    if (!line.trim() || /^\s*\[/.test(line)) {
      flush()
      continue
    }
    current.push(line)
  }
  flush()
  return blocks
}

function matchField(text: string, field: string): string | null {
  const pattern = new RegExp(
    `${field}\\s*[:=]\\s*(?:"([^"]*)"|'([^']*)'|([^\\s,]+))`,
    "i",
  )
  const match = pattern.exec(text)
  if (!match) return null
  return match[1] ?? match[2] ?? match[3] ?? null
}

/** The operator's own words must name the account. The model cannot choose a different one. */
export function userNamedAccount(userText: string, account: string): boolean {
  const name = account.trim()
  if (name.length < 2 || name.length > 64) return false
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`(?:^|[^A-Za-z0-9_.-])${escaped}(?:[^A-Za-z0-9_.-]|$)`, "i").test(userText)
}
