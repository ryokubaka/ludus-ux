import { NextResponse } from "next/server"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

export async function GET() {
  try {
    const filePath = join(process.cwd(), "CHANGELOG.md")
    const content = await readFile(filePath, "utf-8")
    return new NextResponse(content, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    })
  } catch {
    return NextResponse.json({ error: "Changelog not found" }, { status: 404 })
  }
}
