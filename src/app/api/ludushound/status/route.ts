import { NextRequest, NextResponse } from "next/server"
import { getSettings } from "@/lib/settings-store"
import { resolveLudushoundSession } from "@/lib/ludushound-session"
import { isLudushoundSshConfigured, probeLudushoundHost } from "@/lib/ludushound-ssh"
import { isLudushoundCollectionInstalled } from "@/lib/ludushound-ansible-requirements"
import type { LudushoundStatus } from "@/lib/types"

export async function GET(request: NextRequest) {
  const ctx = await resolveLudushoundSession(request)
  if (!ctx) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const settings = getSettings()
  if (!settings.ludushoundEnabled) {
    const body: LudushoundStatus = {
      configured: false,
      enabled: false,
      ludushoundPath: settings.ludushoundPath,
      repoPresent: false,
      binaryPresent: false,
      goAvailable: false,
      collectionInstalled: false,
      collectionTarballPresent: false,
      collectionTarballPath: "",
      message: "LudusHound integration disabled (ENABLE_LUDUSHOUND=false).",
    }
    return NextResponse.json(body)
  }

  if (!isLudushoundSshConfigured()) {
    const body: LudushoundStatus = {
      configured: false,
      enabled: true,
      ludushoundPath: settings.ludushoundPath,
      repoPresent: false,
      binaryPresent: false,
      goAvailable: false,
      collectionInstalled: false,
      collectionTarballPresent: false,
      collectionTarballPath: "",
      message: "SSH not configured. Set LUDUS_SSH_HOST.",
    }
    return NextResponse.json(body)
  }

  const probe = await probeLudushoundHost(ctx.creds)
  let collectionInstalled = false
  try {
    collectionInstalled = await isLudushoundCollectionInstalled(ctx.apiKey)
  } catch {
    /* ansible list may fail; surface host probe anyway */
  }

  const body: LudushoundStatus = {
    configured: probe.configured,
    enabled: true,
    ludushoundPath: probe.ludushoundPath,
    repoPresent: probe.repoPresent,
    binaryPresent: probe.binaryPresent,
    goAvailable: probe.goAvailable,
    collectionInstalled,
    collectionTarballPresent: probe.collectionTarballPresent,
    collectionTarballPath: probe.collectionTarballPath,
    error: probe.error,
    message: !probe.repoPresent
      ? `LudusHound not found at ${probe.ludushoundPath}. Use “Clone repo” below (needs root SSH + git on the Ludus host), or clone manually.`
      : undefined,
  }
  return NextResponse.json(body)
}
