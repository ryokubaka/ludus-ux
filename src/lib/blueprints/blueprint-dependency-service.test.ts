import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/ui/api", () => ({
  ludusApi: {
    installBlueprintDependencies: vi.fn(),
  },
}))

vi.mock("@/lib/ansible/ansible-requirements-service", () => ({
  fetchInstalledAnsible: vi.fn(),
  installMissingAnsibleRequirements: vi.fn(),
}))

import { ludusApi } from "@/lib/ui/api"
import {
  fetchInstalledAnsible,
  installMissingAnsibleRequirements,
} from "@/lib/ansible/ansible-requirements-service"
import { installBlueprintDependencies } from "@/lib/blueprints/blueprint-dependency-service"

describe("installBlueprintDependencies", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("installs a source role the blueprint install call omits", async () => {
    vi.mocked(ludusApi.installBlueprintDependencies).mockResolvedValue({
      status: 200,
      data: {
        ansibleResults: [{ name: "geerlingguy.docker", ok: true, type: "role" }],
      },
    })
    vi.mocked(fetchInstalledAnsible).mockResolvedValue([
      { name: "geerlingguy.docker", version: "8.0.0", type: "role" },
    ])
    vi.mocked(installMissingAnsibleRequirements).mockResolvedValue({
      ok: true,
      installed: ["whispergate.ludus_threat_hunting"],
      failed: [],
    })

    const result = await installBlueprintDependencies("source/labyrinth", [
      { kind: "role", name: "geerlingguy.docker" },
      { kind: "role", name: "whispergate.ludus_threat_hunting" },
    ])

    expect(installMissingAnsibleRequirements).toHaveBeenCalledWith([
      { kind: "role", name: "whispergate.ludus_threat_hunting" },
    ])
    expect(result.ok).toBe(true)
    expect(result.installed).toContain("whispergate.ludus_threat_hunting")
  })
})
