import "server-only"

import {
  findMissingRequirements,
  requirementsAtWrongVersion,
  type BlueprintRequirement,
} from "@/lib/blueprints/blueprint-dependencies"
import { revalidateLudusResource } from "@/lib/ludus/ludus-cache-revalidate"
import { ensureAnsibleHomeLayoutAsRoot } from "@/lib/ansible/ansible-home-repair"
import { ludusGet, ludusPost } from "@/lib/ludus/ludus-client"
import type { InstallAnsibleRequirementsResult } from "@/lib/ansible/ansible-requirements-service"
import type { AnsibleItem } from "@/lib/core/types"
import { extractArray } from "@/lib/core/utils"

function isAlreadyInstalledAnsible(error: string, status: number): boolean {
  return status === 409 || /already installed/i.test(error) || /nothing to do/i.test(error)
}

export interface InstallAnsibleServerOptions {
  /** Ludus API force reinstall (fixes broken/partial collection trees on disk). */
  force?: boolean
  /** Linux user whose ~/.ansible layout to repair after install (split ownership). */
  linuxUser?: string
}

export async function fetchInstalledAnsibleServer(apiKey: string): Promise<AnsibleItem[]> {
  const res = await ludusGet<unknown>("/ansible", { apiKey })
  if (res.error) throw new Error(res.error)
  return extractArray<AnsibleItem>(res.data)
}

/** Install missing roles/collections via Ludus API (tracked in Ludus + LUX Ansible page). */
export async function installMissingAnsibleRequirementsServer(
  apiKey: string,
  missing: BlueprintRequirement[],
  options: InstallAnsibleServerOptions = {},
): Promise<InstallAnsibleRequirementsResult> {
  const installed: string[] = []
  const failed: { name: string; error: string }[] = []
  const force = options.force === true

  for (const req of missing) {
    const res =
      req.kind === "role"
        ? await ludusPost<{ result?: string }>(
            "/ansible/role",
            {
              role: req.name,
              action: "install",
              ...(req.version ? { version: req.version } : {}),
              ...(force ? { force: true } : {}),
            },
            { apiKey },
          )
        : await ludusPost<{ result?: string }>(
            "/ansible/collection",
            {
              collection: req.name,
              action: "install",
              ...(req.version ? { version: req.version } : {}),
              ...(force ? { force: true } : {}),
            },
            { apiKey },
          )

    if (res.error) {
      if (!force && isAlreadyInstalledAnsible(res.error, res.status)) {
        installed.push(req.name)
        continue
      }
      failed.push({ name: req.name, error: res.error })
      continue
    }
    installed.push(req.name)
  }

  if (installed.length > 0) {
    revalidateLudusResource("ansible")
    if (options.linuxUser?.trim()) {
      await ensureAnsibleHomeLayoutAsRoot(options.linuxUser)
    }
  }

  return {
    ok: failed.length === 0,
    installed,
    failed,
  }
}

export async function findMissingAnsibleRequirementsServer(
  apiKey: string,
  required: BlueprintRequirement[],
): Promise<BlueprintRequirement[]> {
  const installed = await fetchInstalledAnsibleServer(apiKey)
  return findMissingRequirements(installed, required)
}

/** Installed, but not the version Ludus pinned. A later install must pass that version. */
export async function findWrongVersionAnsibleRequirementsServer(
  apiKey: string,
  required: BlueprintRequirement[],
): Promise<BlueprintRequirement[]> {
  const installed = await fetchInstalledAnsibleServer(apiKey)
  return requirementsAtWrongVersion(installed, required)
}
