import { NextRequest, NextResponse } from "next/server"
import { resolveSession } from "@/lib/session/session"
import { isGoadConfigured, readGoadDomainCatalog, readGoadDomainSources } from "@/lib/goad/goad-ssh"
import {
  EMPTY_GOAD_DIRECTORY,
  applyMemberDomains,
  buildGoadDirectory,
  isSafeGoadName,
  learnGoadDomains,
  type GoadRawDomain,
  type GoadRawHost,
} from "@/lib/goad/goad-domain-map"

/**
 * GET /api/goad/domain-map?lab=GOAD&extensions=adfs,sccm
 * Domain, DC, and member rows from the lab and extension config. Passwords stay on the host.
 */
export async function GET(request: NextRequest) {
  const session = await resolveSession(request)
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const creds = session.sshPassword
    ? { username: session.username, password: session.sshPassword }
    : undefined

  if (request.nextUrl.searchParams.get("discover") === "1") {
    if (!isGoadConfigured()) return NextResponse.json({ labs: [], extensions: [] })
    const catalog = await readGoadDomainCatalog(creds)
    const publish = (groups: { name: string; hosts: GoadRawHost[]; domains: GoadRawDomain[] }[]) =>
      groups.map((group) => ({ name: group.name, ...buildGoadDirectory(group.hosts, group.domains) }))
    return NextResponse.json({ labs: publish(catalog.labs), extensions: publish(catalog.extensions) })
  }

  const lab = request.nextUrl.searchParams.get("lab")?.trim() ?? ""
  const extensions = (request.nextUrl.searchParams.get("extensions") ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)

  if (!lab || !isSafeGoadName(lab) || extensions.some((name) => !isSafeGoadName(name))) {
    return NextResponse.json({ error: "Invalid lab or extension name" }, { status: 400 })
  }

  if (!isGoadConfigured()) {
    return NextResponse.json(EMPTY_GOAD_DIRECTORY)
  }

  const raw = await readGoadDomainSources(lab, extensions, creds)
  const learned = learnGoadDomains(
    applyMemberDomains(raw.hosts, raw.joins),
    raw.domains,
    raw.plays,
    raw.inventory,
    raw.groups,
  )
  const directory = buildGoadDirectory(learned.hosts, learned.domains)
  return NextResponse.json({ ...directory, vms: raw.vms })
}
