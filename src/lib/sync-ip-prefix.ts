const OCTET = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)"
const IPV4_PREFIX = new RegExp(`^(${OCTET}(?:\\.${OCTET})*)$`)

/** One IPv4 octet, or null. Uses the regex capture so a non-numeric range id cannot reach a shell. */
export function ipv4Octet(value: unknown): string | null {
  const text = typeof value === "number" && Number.isInteger(value) ? String(value) : value
  if (typeof text !== "string") return null
  return text.match(new RegExp(`^(${OCTET})$`))?.[1] ?? null
}

/**
 * IPv4 prefix as a sed pattern. Rejects anything that is not dots and octets.
 * The capture is escaped for backslash and the other sed metacharacters.
 */
export function sedPatternForIpPrefix(value: string): string | null {
  const captured = value.match(IPV4_PREFIX)?.[1]
  if (!captured) return null
  return captured.replace(/[\\.^$*[\]|&]/g, "\\$&")
}
