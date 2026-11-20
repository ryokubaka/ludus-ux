import { lookup } from "node:dns/promises"
import { isIP } from "node:net"

export type LuxaiEgress = "local" | "cloud"

export type AddressLookup = (hostname: string) => Promise<string[]>

const LOCAL_V4: Array<[number, number]> = [
  [ip4("10.0.0.0"), cidrMask(8)],
  [ip4("172.16.0.0"), cidrMask(12)],
  [ip4("192.168.0.0"), cidrMask(16)],
  [ip4("127.0.0.0"), cidrMask(8)],
  [ip4("169.254.0.0"), cidrMask(16)],
]

function ip4(text: string): number {
  const parts = text.split(".").map((part) => Number(part))
  return (((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0)
}

function cidrMask(bits: number): number {
  return bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
}

function inNet(addr: number, network: number, mask: number): boolean {
  return (addr & mask) === (network & mask)
}

/** True for an address LUXAI may call in local mode. */
export function isLocalAddress(address: string): boolean {
  const bare = unwrap(address)
  if (!bare) return false
  if (isMetadataAddress(bare)) return false
  if (bare.includes(":")) return isLocalV6(bare)
  if (isIP(bare) !== 4) return false
  const value = ip4(bare)
  if (inNet(value, ip4("0.0.0.0"), cidrMask(8))) return false
  if (inNet(value, ip4("100.64.0.0"), cidrMask(10))) return false
  if (inNet(value, ip4("192.0.2.0"), cidrMask(24))) return false
  if (inNet(value, ip4("198.51.100.0"), cidrMask(24))) return false
  if (inNet(value, ip4("203.0.113.0"), cidrMask(24))) return false
  if (inNet(value, ip4("198.18.0.0"), cidrMask(15))) return false
  if (inNet(value, ip4("224.0.0.0"), cidrMask(4))) return false
  if (inNet(value, ip4("240.0.0.0"), cidrMask(4))) return false
  if (value === ip4("169.254.169.254") || value === ip4("169.254.170.2")) return false
  return LOCAL_V4.some(([network, mask]) => inNet(value, network, mask))
}

function unwrap(address: string): string | null {
  let text = address.trim().toLowerCase()
  if (text.startsWith("[") && text.endsWith("]")) text = text.slice(1, -1)
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(text)
  if (dotted) return dotted[1]
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(text)
  if (hex) {
    const hi = Number.parseInt(hex[1], 16)
    const lo = Number.parseInt(hex[2], 16)
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`
  }
  return text
}

function isMetadataAddress(address: string): boolean {
  const bare = unwrap(address)
  if (!bare) return false
  if (bare === "169.254.169.254" || bare === "169.254.170.2" || bare === "100.100.100.200") return true
  return bare === "fd00:ec2::254"
}

function isLocalV6(address: string): boolean {
  if (address === "::1") return true
  if (address.startsWith("fe80:")) return true
  if (address.startsWith("fc") || address.startsWith("fd")) return true
  return false
}

/** Cloud mode refuses addresses that only make sense on the local machine. */
export function isCloudBlockedAddress(address: string): boolean {
  const bare = unwrap(address)
  if (!bare) return true
  if (isMetadataAddress(bare)) return true
  if (bare.includes(":")) {
    if (bare === "::" || bare === "::1") return true
    if (bare.startsWith("fe80:")) return true
    if (bare.startsWith("2002:")) return true
    if (bare.startsWith("2001:0:")) return true
    if (bare.startsWith("64:ff9b:")) return true
    return false
  }
  if (isIP(bare) !== 4) return true
  const value = ip4(bare)
  if (inNet(value, ip4("0.0.0.0"), cidrMask(8))) return true
  if (inNet(value, ip4("127.0.0.0"), cidrMask(8))) return true
  if (inNet(value, ip4("169.254.0.0"), cidrMask(16))) return true
  if (inNet(value, ip4("224.0.0.0"), cidrMask(4))) return true
  if (inNet(value, ip4("240.0.0.0"), cidrMask(4))) return true
  return false
}

const BLOCKED_NAMES = new Set([
  "metadata.google.internal",
  "metadata.google",
  "localhost",
  "localhost.localdomain",
])

export function normalizeOpenAiBase(input: string): string {
  let url = input.trim().replace(/\/+$/, "")
  url = url.replace(/\/chat\/completions$/i, "")
  url = url.replace(/\/models$/i, "")
  return url
}

export function anthropicMessagesUrl(base: string): string {
  let url = base.trim().replace(/\/+$/, "")
  url = url.replace(/\/v1\/messages$/i, "")
  url = url.replace(/\/messages$/i, "")
  url = url.replace(/\/v1$/i, "")
  return `${url}/v1/messages`
}

export function anthropicModelsUrl(base: string): string {
  return anthropicMessagesUrl(base).replace(/\/messages$/, "/models")
}

export async function defaultAddressLookup(hostname: string): Promise<string[]> {
  if (isIP(hostname)) return [hostname]
  try {
    const records = await lookup(hostname, { all: true, verbatim: true })
    return records.map((record) => record.address)
  } catch {
    return []
  }
}

/**
 * Check a model base URL before any request is sent.
 * `lookup` resolves names. One disallowed address rejects the name.
 */
export async function assertModelBaseUrl(
  raw: string,
  egress: LuxaiEgress,
  lookup: AddressLookup,
): Promise<URL> {
  let parsed: URL
  try {
    parsed = new URL(raw.trim())
  } catch {
    throw new Error("Model URL is not a valid URL.")
  }
  if (parsed.username || parsed.password) {
    throw new Error("Model URL cannot contain a username or password.")
  }
  if (parsed.search || parsed.hash) {
    throw new Error("Model URL cannot contain a query or a fragment.")
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Model URL must be http or https.")
  }
  if (egress === "cloud" && parsed.protocol !== "https:") {
    throw new Error("A cloud model URL must be https.")
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase()
  if (!host) throw new Error("Model URL needs a host.")
  if (host === "metadata.google.internal" || host === "metadata.google") {
    throw new Error("That host is not a model endpoint.")
  }
  if (BLOCKED_NAMES.has(host) && egress === "cloud") {
    throw new Error("That host is not a cloud model endpoint.")
  }
  const addresses = isIP(host) ? [host] : await lookup(host)
  if (addresses.length === 0) {
    throw new Error("Model host did not resolve.")
  }
  for (const address of addresses) {
    if (egress === "local" && !isLocalAddress(address)) {
      throw new Error("Local mode only allows a private, loopback, or link-local address. Switch egress to cloud for a public model.")
    }
    if (egress === "cloud" && isCloudBlockedAddress(address)) {
      throw new Error("Cloud mode refuses loopback, link-local, and metadata addresses.")
    }
  }
  return parsed
}

/** Check the URL, and for plain HTTP use the address that passed the check. */
export async function prepareModelUrl(
  raw: string,
  egress: LuxaiEgress,
  lookup: AddressLookup,
): Promise<string> {
  const parsed = await assertModelBaseUrl(raw, egress, lookup)
  const host = parsed.hostname.replace(/^\[|\]$/g, "")
  if (parsed.protocol !== "http:" || isIP(host)) {
    return parsed.toString().replace(/\/$/, "")
  }
  const addresses = await lookup(host)
  const chosen = addresses.find((address) => (egress === "local" ? isLocalAddress(address) : !isCloudBlockedAddress(address)))
  if (!chosen) throw new Error("Model host did not resolve to an allowed address.")
  const pinned = new URL(parsed.toString())
  pinned.hostname = chosen
  return pinned.toString().replace(/\/$/, "")
}
