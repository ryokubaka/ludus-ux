/**
 * GET  /api/profile/avatar          — serve the current user's avatar
 * GET  /api/profile/avatar?u=xyz    — serve a specific user's avatar (any auth'd user)
 * POST /api/profile/avatar          — upload / replace current user's avatar (multipart)
 * DELETE /api/profile/avatar        — remove current user's avatar
 */
import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/session"
import { DATA_DIR } from "@/lib/db"
import fs from "fs"
import path from "path"

export const dynamic = "force-dynamic"

const AVATARS_DIR = path.join(DATA_DIR, "avatars")
const MAX_SIZE = 4 * 1024 * 1024 // 4 MB
const VALID_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png":  "png",
  "image/webp": "webp",
  "image/gif":  "gif",
}

function findAvatar(username: string): { filePath: string; contentType: string } | null {
  for (const [mime, ext] of Object.entries(VALID_TYPES)) {
    const filePath = path.join(AVATARS_DIR, `${username}.${ext}`)
    if (fs.existsSync(filePath)) return { filePath, contentType: mime }
  }
  return null
}

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const username = request.nextUrl.searchParams.get("u") ?? session.username
  const found = findAvatar(username)
  if (!found) return NextResponse.json({ error: "No avatar" }, { status: 404 })

  const data = fs.readFileSync(found.filePath)
  return new NextResponse(data, {
    headers: {
      "Content-Type": found.contentType,
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  })
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  let formData: FormData
  try { formData = await request.formData() }
  catch { return NextResponse.json({ error: "Invalid multipart body" }, { status: 400 }) }

  const file = formData.get("avatar") as File | null
  if (!file || file.size === 0) return NextResponse.json({ error: "No file provided" }, { status: 400 })

  const ext = VALID_TYPES[file.type]
  if (!ext) return NextResponse.json({ error: "File must be JPEG, PNG, WebP, or GIF" }, { status: 415 })
  if (file.size > MAX_SIZE) return NextResponse.json({ error: "File exceeds 4 MB limit" }, { status: 413 })

  fs.mkdirSync(AVATARS_DIR, { recursive: true })

  // Remove any existing avatar for this user
  for (const e of Object.values(VALID_TYPES)) {
    const old = path.join(AVATARS_DIR, `${session.username}.${e}`)
    if (fs.existsSync(old)) fs.unlinkSync(old)
  }

  const dest = path.join(AVATARS_DIR, `${session.username}.${ext}`)
  const buffer = Buffer.from(await file.arrayBuffer())
  fs.writeFileSync(dest, buffer)

  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  for (const e of Object.values(VALID_TYPES)) {
    const p = path.join(AVATARS_DIR, `${session.username}.${e}`)
    if (fs.existsSync(p)) fs.unlinkSync(p)
  }
  return NextResponse.json({ ok: true })
}
