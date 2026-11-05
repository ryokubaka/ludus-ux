const SAFE_USERNAME = /^[a-zA-Z0-9._-]+$/

export function sanitizeUsername(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed || trimmed.length > 64) return null
  if (!SAFE_USERNAME.test(trimmed)) return null
  if (trimmed.includes("..")) return null
  return trimmed
}

const MAGIC: Array<{ ext: string; mime: string; bytes: number[] }> = [
  { ext: "jpg", mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { ext: "png", mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47] },
  { ext: "gif", mime: "image/gif", bytes: [0x47, 0x49, 0x46] },
  { ext: "webp", mime: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46] },
]

export function detectImageType(buffer: Buffer): { ext: string; mime: string } | null {
  if (buffer.length < 3) return null

  for (const sig of MAGIC) {
    if (buffer.length < sig.bytes.length) continue
    if (sig.bytes.every((b, i) => buffer[i] === b)) {
      if (sig.ext === "webp") {
        const tag = buffer.toString("ascii", 8, 12)
        if (tag !== "WEBP") return null
      }
      return { ext: sig.ext, mime: sig.mime }
    }
  }
  return null
}
