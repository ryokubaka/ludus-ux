import { beforeEach, describe, expect, it, vi } from "vitest"
import { goadPathFromEnv } from "./install-path-env"

vi.mock("@/lib/goad-ssh", () => ({
  sshExec: vi.fn(),
  sshExecAccount: vi.fn(),
}))

vi.mock("@/lib/ansible-home-repair", () => ({
  ensureAnsibleHomeLayoutAsRoot: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/ansible-requirements-server", () => ({
  findMissingAnsibleRequirementsServer: vi.fn(),
  installMissingAnsibleRequirementsServer: vi.fn(),
}))

import { sshExec, sshExecAccount } from "@/lib/goad-ssh"
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
    vi.resetAllMocks()
  })

  it("installs missing deps via Ludus API before GOAD runs", async () => {
    vi.mocked(sshExecAccount).mockResolvedValueOnce({ stdout: REQUIREMENTS, stderr: "", code: 0 })
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
    vi.mocked(sshExecAccount).mockResolvedValueOnce({ stdout: REQUIREMENTS, stderr: "", code: 0 })
    vi.mocked(sshExec)
      .mockResolvedValueOnce({ stdout: "FAIL:ansible.windows\n", stderr: "", code: 0 })
      .mockResolvedValueOnce({ stdout: "OK:community.windows\n", stderr: "", code: 0 })
      .mockResolvedValueOnce({ stdout: "OK:ansible.windows\n", stderr: "", code: 0 })
      .mockResolvedValueOnce({ stdout: "OK:community.windows\n", stderr: "", code: 0 })
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
      "labuser",
    )

    expect(result.ok).toBe(true)
    expect(installMissingAnsibleRequirementsServer).toHaveBeenCalledWith(
      "ROOT.test-key",
      [expect.objectContaining({ name: "ansible.windows" })],
      { force: true, linuxUser: "labuser" },
    )
  })

  it("reads requirements via root SSH and verifies collections as impersonated user", async () => {
    vi.mocked(sshExecAccount).mockResolvedValueOnce({ stdout: REQUIREMENTS, stderr: "", code: 0 })
    vi.mocked(sshExec).mockResolvedValueOnce({ stdout: "LUX_ANSIBLE_VERIFY_DONE\n", stderr: "", code: 0 })
    vi.mocked(findMissingAnsibleRequirementsServer).mockResolvedValue([])

    await ensureGoadAnsibleRequirements(
      "ROOT.test-key",
      undefined,
      () => {},
      goadPathFromEnv(),
      IMPERSONATED_SSH_USER,
    )

    expect(String(vi.mocked(sshExecAccount).mock.calls[0]?.[0])).toContain("requirements")
    expect(String(vi.mocked(sshExecAccount).mock.calls[0]?.[0])).not.toContain("sudo -H -u")
    expect(vi.mocked(sshExec).mock.calls[0]?.[0]).toEqual([
      "ansible-collection-file",
      IMPERSONATED_SSH_USER,
      "ansible",
      "windows",
      "plugins/modules/win_dns_client.ps1",
    ])
  })

  it("passes impersonated linuxUser to Ludus API install for ansible home repair", async () => {
    vi.mocked(sshExecAccount).mockResolvedValueOnce({ stdout: REQUIREMENTS, stderr: "", code: 0 })
    vi.mocked(sshExec).mockResolvedValueOnce({ stdout: "LUX_ANSIBLE_VERIFY_DONE\n", stderr: "", code: 0 })
    vi.mocked(findMissingAnsibleRequirementsServer).mockResolvedValue([
      { kind: "role", name: "geerlingguy.mysql" },
    ])
    vi.mocked(installMissingAnsibleRequirementsServer).mockResolvedValue({
      ok: true,
      installed: ["geerlingguy.mysql"],
      failed: [],
    })

    await ensureGoadAnsibleRequirements(
      "ROOT.test-key",
      undefined,
      () => {},
      goadPathFromEnv(),
      IMPERSONATED_SSH_USER,
    )

    expect(installMissingAnsibleRequirementsServer).toHaveBeenCalledWith(
      "ROOT.test-key",
      expect.any(Array),
      { force: false, linuxUser: IMPERSONATED_SSH_USER },
    )
  })

  it("reads requirements as the logged-in user when that session has SSH credentials", async () => {
    const creds = { username: "labuser", password: "secret" }
    vi.mocked(sshExec).mockResolvedValueOnce({ stdout: REQUIREMENTS, stderr: "", code: 0 })
    vi.mocked(findMissingAnsibleRequirementsServer).mockResolvedValue([])

    const result = await ensureGoadAnsibleRequirements(
      "ROOT.test-key",
      creds,
      () => {},
      goadPathFromEnv(),
    )

    expect(result.ok).toBe(true)
    expect(sshExec).toHaveBeenCalledWith(expect.stringContaining("$G/$F"), creds)
    expect(sshExecAccount).not.toHaveBeenCalled()
  })
})
