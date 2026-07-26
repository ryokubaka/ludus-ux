import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/goad-ssh", () => ({
  sshExec: vi.fn(),
}))

vi.mock("@/lib/ansible-home-repair", () => ({
  ensureAnsibleHomeLayoutAsRoot: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/ansible-requirements-server", () => ({
  findMissingAnsibleRequirementsServer: vi.fn(),
  installMissingAnsibleRequirementsServer: vi.fn(),
}))

import { sshExec } from "@/lib/goad-ssh"
import {
  findMissingAnsibleRequirementsServer,
  installMissingAnsibleRequirementsServer,
} from "@/lib/ansible-requirements-server"
import { ensureLudusPlatformAnsibleRequirements } from "./ludus-platform-ansible-requirements"

const LUDUS_REQUIREMENTS = `
roles:
  - name: ansible-thoteam.nexus3-oss
    version: v2.5.2
collections:
  - name: ansible.posix
    version: 1.6.2
`

describe("ensureLudusPlatformAnsibleRequirements", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("installs missing Ludus platform roles before range deploy", async () => {
    vi.mocked(sshExec).mockResolvedValueOnce({
      stdout: LUDUS_REQUIREMENTS,
      stderr: "",
      code: 0,
    })
    vi.mocked(findMissingAnsibleRequirementsServer).mockResolvedValue([
      { kind: "role", name: "ansible-thoteam.nexus3-oss", version: "v2.5.2" },
    ])
    vi.mocked(installMissingAnsibleRequirementsServer).mockResolvedValue({
      ok: true,
      installed: ["ansible-thoteam.nexus3-oss"],
      failed: [],
    })

    const lines: string[] = []
    const result = await ensureLudusPlatformAnsibleRequirements(
      "melchior.key",
      undefined,
      (line) => lines.push(line),
      "/opt/ludus",
      "melchior",
    )

    expect(result.ok).toBe(true)
    expect(installMissingAnsibleRequirementsServer).toHaveBeenCalledWith(
      "melchior.key",
      expect.arrayContaining([
        expect.objectContaining({ name: "ansible-thoteam.nexus3-oss" }),
      ]),
      { linuxUser: "melchior" },
    )
    expect(lines.some((l) => l.includes("platform Ansible"))).toBe(true)
    expect(lines.some((l) => l.includes("Repaired ~/.ansible"))).toBe(false)
  })
})
