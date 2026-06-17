import { NextRequest, NextResponse } from "next/server"
import { searchGalaxyCollections, searchGalaxyRoles } from "@/lib/ansible-galaxy-api"
import type { GalaxySearchHit } from "@/lib/ansible-galaxy-search"

/** Proxy Ansible Galaxy search for LUX add dialogs (avoids browser CORS). */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const q = (searchParams.get("q") ?? "").trim()
  const type = searchParams.get("type") === "collection" ? "collection" : "role"

  if (q.length < 2) {
    return NextResponse.json({ items: [] as GalaxySearchHit[] })
  }

  try {
    const items =
      type === "collection" ? await searchGalaxyCollections(q) : await searchGalaxyRoles(q)
    return NextResponse.json({ items })
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "Galaxy search failed" },
      { status: 502 },
    )
  }
}
