import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import path from "path"
import { getSessionFromRequest } from "@/lib/session"
import { DATA_DIR } from "@/lib/db"

const UPLOADS_DIR = path.join(DATA_DIR, "uploads")
const LOGO_EXTS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]
const MIME: Record<string, string> = {
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif":  "image/gif",
  ".webp": "image/webp",
  ".svg":  "image/svg+xml",
}

function findLogo(): string | null {
  for (const ext of LOGO_EXTS) {
    const p = path.join(UPLOADS_DIR, `logo${ext}`)
    if (fs.existsSync(p)) return p
  }
  return null
}

const DEFAULT_LOGO_PATH = path.join(process.cwd(), "public", "default-logo.jpeg")

function serveBundledDefault(): NextResponse {
  if (!fs.existsSync(DEFAULT_LOGO_PATH)) {
    return new NextResponse(null, { status: 404 })
  }
  const content = fs.readFileSync(DEFAULT_LOGO_PATH)
  return new NextResponse(content, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  })
}

/**
 * Custom logo bytes if uploaded; otherwise bundled default. Avoids 404 on
 * `<img src="/api/logo">` and keeps HEAD vs GET consistent.
 */
export async function GET() {
  const logoPath = findLogo()
  if (!logoPath) return serveBundledDefault()

  const ext = path.extname(logoPath).toLowerCase()
  const content = fs.readFileSync(logoPath)
  return new NextResponse(content, {
    headers: {
      "Content-Type": MIME[ext] ?? "image/png",
      // No browser caching — we want the sidebar to pick up a new upload immediately
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  })
}

/** 200 = custom logo on disk; 204 = using default only (not an error — avoids console 404 noise). */
export async function HEAD() {
  const logoPath = findLogo()
  if (!logoPath) {
    return new NextResponse(null, { status: 204 })
  }
  const ext = path.extname(logoPath).toLowerCase()
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Content-Type": MIME[ext] ?? "image/png",
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  })
}

/** Upload a new logo (admin only). Replaces any existing logo. */
export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session?.isAdmin) return NextResponse.json({ error: "Admin required" }, { status: 403 })

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: "Invalid multipart request" }, { status: 400 })
  }

  const file = formData.get("logo") as File | null
  if (!file || !file.name) return NextResponse.json({ error: "No file provided" }, { status: 400 })

  const ext = path.extname(file.name).toLowerCase()
  if (!LOGO_EXTS.includes(ext)) {
    return NextResponse.json({ error: `Unsupported format. Allowed: ${LOGO_EXTS.join(", ")}` }, { status: 400 })
  }

  // Remove any existing logo before writing the new one
  for (const e of LOGO_EXTS) {
    const old = path.join(UPLOADS_DIR, `logo${e}`)
    if (fs.existsSync(old)) fs.unlinkSync(old)
  }

  fs.mkdirSync(UPLOADS_DIR, { recursive: true })
  const dest = path.join(UPLOADS_DIR, `logo${ext}`)
  const buf = Buffer.from(await file.arrayBuffer())
  fs.writeFileSync(dest, buf)

  return NextResponse.json({ success: true })
}

/** Delete the custom logo (admin only). */
export async function DELETE(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session?.isAdmin) return NextResponse.json({ error: "Admin required" }, { status: 403 })

  const logoPath = findLogo()
  if (!logoPath) return NextResponse.json({ error: "No logo set" }, { status: 404 })

  fs.unlinkSync(logoPath)
  return NextResponse.json({ success: true })
}
