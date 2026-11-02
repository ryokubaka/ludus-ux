/**
 * Input validation helpers for identifiers used in shell commands and file paths.
 */

const NUMERIC_RE = /^\d+$/

/** True when the value is a non-empty string of digits (Proxmox VM IDs, port numbers). */
export function isNumericId(value: string): boolean {
  return NUMERIC_RE.test(value)
}

const SAFE_NODE_RE = /^[a-zA-Z0-9._-]+$/

/** True when the value looks like a valid Proxmox node name (alphanumeric + dots/hyphens/underscores). */
export function isSafeNodeName(value: string): boolean {
  return value.length > 0 && value.length <= 253 && SAFE_NODE_RE.test(value)
}
