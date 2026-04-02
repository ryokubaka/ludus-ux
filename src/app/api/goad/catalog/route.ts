import { NextRequest, NextResponse } from "next/server"
import { discoverGoadCatalog, invalidateCatalogCache, isGoadConfigured } from "@/lib/goad-ssh"
import { getSessionFromRequest } from "@/lib/session"

async function getCreds(request: NextRequest) {
  const session = await getSessionFromRequest(request)
  return session?.sshPassword
    ? { username: session.username, password: session.sshPassword }
    : undefined
}

export async function GET(request: NextRequest) {
  if (!isGoadConfigured()) {
    return NextResponse.json({
      configured: false,
      goadPath: "",
      labs: [],
      extensions: [],
      message: "GOAD SSH not configured. Set LUDUS_SSH_HOST in your environment.",
    })
  }

  try {
    const catalog = await discoverGoadCatalog(await getCreds(request))
    return NextResponse.json(catalog)
  } catch (err) {
    return NextResponse.json(
      {
        configured: true,
        goadPath: "",
        labs: [],
        extensions: [],
        error: `Failed to discover GOAD catalog: ${(err as Error).message}`,
      },
      { status: 500 }
    )
  }
}

/** POST with no body invalidates the server-side cache and re-fetches. */
export async function POST(request: NextRequest) {
  if (!isGoadConfigured()) {
    return NextResponse.json({ configured: false }, { status: 400 })
  }

  invalidateCatalogCache()

  try {
    const catalog = await discoverGoadCatalog(await getCreds(request))
    return NextResponse.json(catalog)
  } catch (err) {
    return NextResponse.json(
      { error: `Refresh failed: ${(err as Error).message}` },
      { status: 500 }
    )
  }
}
