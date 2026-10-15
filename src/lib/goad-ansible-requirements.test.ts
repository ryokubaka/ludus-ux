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
      .mockResolvedValueOnce({ stdout: "FAIL:ansible.windows\n", stderr: "ansible-galaxy: denied", code: 0 })
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
    expect(vi.mocked(sshExec).mock.calls[2]?.[0]).toEqual([
      "ansible-collection-repair",
      "labuser",
      "ansible",
      "windows",
      "plugins/modules/win_dns_client.ps1",
    ])
  })

  it("reads requirements via root SSH and verifies collections as impersonated user", async () => {
    vi.mocked(sshExecAccount).mockResolvedValueOnce({ stdout: REQUIREMENTS, stderr: "", code: 0 })
    vi.mocked(sshExec)
      .mockResolvedValueOnce({ stdout: "OK:ansible.windows\n", stderr: "", code: 0 })
      .mockResolvedValueOnce({ stdout: "OK:community.windows\n", stderr: "", code: 0 })
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
    expect(vi.mocked(sshExec).mock.calls.map((call) => call[0])).toEqual([
      [
        "ansible-collection-file",
        IMPERSONATED_SSH_USER,
        "ansible",
        "windows",
        "plugins/modules/win_dns_client.ps1",
      ],
      [
        "ansible-collection-file",
        IMPERSONATED_SSH_USER,
        "community",
        "windows",
        "plugins/modules/win_http_proxy.ps1",
      ],
    ])
  })

  it("installs community.mysql when only the geerlingguy.mysql role is present, and force-reinstalls a missing module file", async () => {
    const requirements = `
collections:
  - name: community.mysql
roles:
  - name: geerlingguy.mysql
`
    vi.mocked(sshExecAccount).mockResolvedValueOnce({ stdout: requirements, stderr: "", code: 0 })
    vi.mocked(sshExec)
      .mockResolvedValueOnce({ stdout: "FAIL:community.mysql\n", stderr: "", code: 0 })
      .mockResolvedValueOnce({ stdout: "OK:ansible.mysql\n", stderr: "", code: 0 })
      .mockResolvedValueOnce({ stdout: "OK:community.mysql\n", stderr: "", code: 0 })
      .mockResolvedValueOnce({ stdout: "OK:community.mysql\n", stderr: "", code: 0 })
      .mockResolvedValueOnce({ stdout: "OK:ansible.mysql\n", stderr: "", code: 0 })
    vi.mocked(findMissingAnsibleRequirementsServer).mockResolvedValue([
      { kind: "collection", name: "community.mysql" },
    ])
    vi.mocked(installMissingAnsibleRequirementsServer).mockResolvedValue({
      ok: true,
      installed: ["community.mysql"],
      failed: [],
    })

    const result = await ensureGoadAnsibleRequirements(
      "ROOT.test-key",
      undefined,
      () => {},
      goadPathFromEnv(),
      IMPERSONATED_SSH_USER,
    )

    expect(result.ok).toBe(true)
    expect(installMissingAnsibleRequirementsServer).toHaveBeenCalledTimes(1)
    expect(installMissingAnsibleRequirementsServer).toHaveBeenCalledWith(
      "ROOT.test-key",
      [expect.objectContaining({ kind: "collection", name: "community.mysql" })],
      { force: false, linuxUser: IMPERSONATED_SSH_USER },
    )
    expect(vi.mocked(sshExec).mock.calls[2]?.[0]).toEqual([
      "ansible-collection-repair",
      IMPERSONATED_SSH_USER,
      "community",
      "mysql",
      "MANIFEST.json",
    ])
    expect(vi.mocked(sshExec).mock.calls[0]?.[0]).toEqual([
      "ansible-collection-file",
      IMPERSONATED_SSH_USER,
      "community",
      "mysql",
      "plugins/modules/mysql_user.py",
    ])
  })

  it("passes impersonated linuxUser to Ludus API install for ansible home repair", async () => {
    vi.mocked(sshExecAccount).mockResolvedValueOnce({ stdout: REQUIREMENTS, stderr: "", code: 0 })
    vi.mocked(sshExec)
      .mockResolvedValueOnce({ stdout: "OK:ansible.windows\n", stderr: "", code: 0 })
      .mockResolvedValueOnce({ stdout: "OK:community.windows\n", stderr: "", code: 0 })
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
