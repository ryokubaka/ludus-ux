import { beforeEach, describe, expect, it, vi } from "vitest"
import { goadPathFromEnv } from "./install-path-env"

vi.mock("@/lib/goad-ssh", () => ({
  sshExec: vi.fn(),
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
import { ensureGoadAnsibleRequirements } from "./goad-ansible-requirements"

const IMPERSONATED_SSH_USER = "labuser"

const REQUIREMENTS = `
collections:
  - name: ansible.windows
    version: 2.5.0
  - name: community.windows
    version: 2.3.0
roles:
  - name: geerlingguy.mysql
`

describe("ensureGoadAnsibleRequirements", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("installs missing deps via Ludus API before GOAD runs", async () => {
    vi.mocked(sshExec)
      .mockResolvedValueOnce({ stdout: REQUIREMENTS, stderr: "", code: 0 })
      .mockResolvedValueOnce({ stdout: "LUX_ANSIBLE_VERIFY_DONE\n", stderr: "", code: 0 })
    vi.mocked(findMissingAnsibleRequirementsServer).mockResolvedValue([
      { kind: "collection", name: "ansible.windows", version: "2.5.0" },
    ])
    vi.mocked(installMissingAnsibleRequirementsServer).mockResolvedValue({
      ok: true,
      installed: ["ansible.windows"],
      failed: [],
    })

    const lines: string[] = []
    const result = await ensureGoadAnsibleRequirements(
      "ROOT.test-key",
      undefined,
      (line) => lines.push(line),
      goadPathFromEnv(),
    )

    expect(result.ok).toBe(true)
    expect(installMissingAnsibleRequirementsServer).toHaveBeenCalledWith(
      "ROOT.test-key",
      expect.any(Array),
      { force: false },
    )
    expect(lines.some((l) => l.includes("Ludus API"))).toBe(true)
  })

  it("force reinstalls collections that fail on-disk verification", async () => {
    vi.mocked(sshExec)
      .mockResolvedValueOnce({ stdout: REQUIREMENTS, stderr: "", code: 0 })
      .mockResolvedValueOnce({ stdout: "FAIL:ansible.windows\nLUX_ANSIBLE_VERIFY_DONE\n", stderr: "", code: 0 })
      .mockResolvedValueOnce({ stdout: "LUX_ANSIBLE_VERIFY_DONE\n", stderr: "", code: 0 })
    vi.mocked(findMissingAnsibleRequirementsServer).mockResolvedValue([])
    vi.mocked(installMissingAnsibleRequirementsServer).mockResolvedValue({
      ok: true,
      installed: ["ansible.windows"],
      failed: [],
    })

    const result = await ensureGoadAnsibleRequirements(
      "ROOT.test-key",
      undefined,
      () => {},
      goadPathFromEnv(),
    )

    expect(result.ok).toBe(true)
    expect(installMissingAnsibleRequirementsServer).toHaveBeenCalledWith(
      "ROOT.test-key",
      [expect.objectContaining({ name: "ansible.windows" })],
      { force: true },
    )
  })

  it("uses sudo when reading requirements for impersonated user", async () => {
    vi.mocked(sshExec)
      .mockResolvedValueOnce({ stdout: REQUIREMENTS, stderr: "", code: 0 })
      .mockResolvedValueOnce({ stdout: "LUX_ANSIBLE_VERIFY_DONE\n", stderr: "", code: 0 })
    vi.mocked(findMissingAnsibleRequirementsServer).mockResolvedValue([])

    await ensureGoadAnsibleRequirements(
      "ROOT.test-key",
      undefined,
      () => {},
      goadPathFromEnv(),
      IMPERSONATED_SSH_USER,
    )

    expect(vi.mocked(sshExec).mock.calls[0]?.[0]).toContain(`sudo -H -u '${IMPERSONATED_SSH_USER}'`)
  })
})
