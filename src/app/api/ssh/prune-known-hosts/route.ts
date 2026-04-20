import { NextResponse } from "next/server"
import { pruneKnownHostsEntries } from "@/lib/ssh-known-hosts"

/**
 * POST { hosts: string[] } — runs `ssh-keygen -R <host>` for each distinct host/IP
 * against the LUX server user's ~/.ssh/known_hosts (same machine as Next.js).
 */
export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const hosts = (body as { hosts?: unknown }).hosts
  if (!Array.isArray(hosts)) {
    return NextResponse.json({ error: "hosts must be an array of strings" }, { status: 400 })
  }
  const list = hosts.filter((h): h is string => typeof h === "string")
  const result = await pruneKnownHostsEntries(list)
  return NextResponse.json({ ok: true, attempted: result.attempted, succeeded: result.succeeded })
}
