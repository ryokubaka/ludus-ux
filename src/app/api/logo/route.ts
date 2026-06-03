import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import path from "path"
import { getSessionFromRequest } from "@/lib/session"
import { DATA_DIR } from "@/lib/db"
import { detectImageType } from "@/lib/safe-filename"
import { logLuxRouteAction } from "@/lib/lux-api-audit"

const UPLOADS_DIR = path.join(DATA_DIR, "uploads")
const LOGO_EXTS = [".png", ".jpg", ".jpeg", ".gif", ".webp"]
const MAX_LOGO_SIZE = 10 * 1024 * 1024 // 10 MB
const MIME: Record<string, string> = {
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif":  "image/gif",
  ".webp": "image/webp",
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

export async function GET() {
  const logoPath = findLogo()
  if (!logoPath) return serveBundledDefault()

  const ext = path.extname(logoPath).toLowerCase()
  const content = fs.readFileSync(logoPath)
  return new NextResponse(content, {
    headers: {
      "Content-Type": MIME[ext] ?? "image/png",
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  })
}

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

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session?.isAdmin) {
    if (session) logLuxRouteAction(request, session, { outcome: "failure", detail: "Admin required" })
    return NextResponse.json({ error: "Admin required" }, { status: 403 })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: "Invalid multipart request" }, { status: 400 })
  }

  const file = formData.get("logo") as File | null
  if (!file || !file.name) return NextResponse.json({ error: "No file provided" }, { status: 400 })
  if (file.size > MAX_LOGO_SIZE) {
    return NextResponse.json({ error: "File exceeds 10 MB limit" }, { status: 413 })
  }

  const ext = path.extname(file.name).toLowerCase()
  if (!LOGO_EXTS.includes(ext)) {
    return NextResponse.json({ error: `Unsupported format. Allowed: ${LOGO_EXTS.join(", ")}` }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const detected = detectImageType(buffer)
  if (!detected) {
    return NextResponse.json({ error: "File must be JPEG, PNG, WebP, or GIF" }, { status: 415 })
  }

  for (const e of LOGO_EXTS) {
    const old = path.join(UPLOADS_DIR, `logo${e}`)
    if (fs.existsSync(old)) fs.unlinkSync(old)
  }

  fs.mkdirSync(UPLOADS_DIR, { recursive: true })
  const dest = path.join(UPLOADS_DIR, `logo.${detected.ext}`)
  fs.writeFileSync(dest, buffer)

  logLuxRouteAction(request, session)
  return NextResponse.json({ success: true })
}

export async function DELETE(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session?.isAdmin) {
    if (session) logLuxRouteAction(request, session, { outcome: "failure", detail: "Admin required" })
    return NextResponse.json({ error: "Admin required" }, { status: 403 })
  }

  const logoPath = findLogo()
  if (!logoPath) {
    logLuxRouteAction(request, session, { outcome: "failure", detail: "No logo set" })
    return NextResponse.json({ error: "No logo set" }, { status: 404 })
  }

  fs.unlinkSync(logoPath)
  logLuxRouteAction(request, session)
  return NextResponse.json({ success: true })
}
