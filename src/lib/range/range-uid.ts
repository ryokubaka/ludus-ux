const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"

/**
 * Six uppercase base36 characters. The GOAD wizard is a client component, so
 * this uses Web Crypto instead of node:crypto. 252 is the largest multiple of
 * 36 below 256, which drops the biased tail of a byte.
 */
export function newRangeUid(): string {
  let out = ""
  const bytes = new Uint8Array(6)
  while (out.length < 6) {
    crypto.getRandomValues(bytes)
    for (const byte of bytes) {
      if (byte >= 252) continue
      out += ALPHABET[byte % 36]
      if (out.length === 6) return out
    }
  }
  return out
}
