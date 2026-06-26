import { ludusApi } from "@/lib/api"
import {
  findMissingRequirements,
  type BlueprintRequirement,
} from "@/lib/blueprint-dependencies"
import type { AnsibleItem } from "@/lib/types"

export interface InstallAnsibleRequirementsResult {
  ok: boolean
  installed: string[]
  failed: { name: string; error: string }[]
}

export function isAlreadyInstalledAnsible(error: string): boolean {
  return /already installed/i.test(error) || /nothing to do/i.test(error)
}

export async function fetchInstalledAnsible(): Promise<AnsibleItem[]> {
  const res = await ludusApi.listAnsible()
  if (res.error) throw new Error(res.error)
  return res.data ?? []
}

/** Install missing roles/collections one at a time via Ludus API. */
export async function installMissingAnsibleRequirements(
  missing: BlueprintRequirement[],
): Promise<InstallAnsibleRequirementsResult> {
  const installed: string[] = []
  const failed: { name: string; error: string }[] = []

  for (const req of missing) {
    const res =
      req.kind === "role"
        ? await ludusApi.addRole(req.name, req.version)
        : await ludusApi.addCollection(req.name, req.version)

    if (res.error) {
      if (isAlreadyInstalledAnsible(res.error)) {
        installed.push(req.name)
        continue
      }
      failed.push({ name: req.name, error: res.error })
      continue
    }
    installed.push(req.name)
  }

  return {
    ok: failed.length === 0,
    installed,
    failed,
  }
}

export function findMissingFromInstalled(
  installed: AnsibleItem[],
  required: BlueprintRequirement[],
): BlueprintRequirement[] {
  return findMissingRequirements(installed, required)
}
