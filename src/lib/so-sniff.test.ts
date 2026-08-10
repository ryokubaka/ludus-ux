import { describe, expect, it } from "vitest"
import {
  isSoVmName,
  net1LooksLikeSniff,
  rangeBridgeName,
  rangeConfigNeedsSoSniff,
  sniffNetSpec,
  wrapRemoteBashScript,
} from "@/lib/so-sniff"

describe("so-sniff helpers", () => {
  it("wraps remote bash so $vars survive sshExec JSON double-quoting", () => {
    const wrapped = wrapRemoteBashScript('echo "$HOME"; if [ -f "$MARKER" ]; then true; fi')
    expect(wrapped).toMatch(/^echo '[A-Za-z0-9+/]+=*' \| base64 -d \| bash -l$/)
    expect(wrapped).not.toContain("$HOME")
    expect(wrapped).not.toContain("$MARKER")
    const b64 = wrapped.match(/^echo '([^']+)'/)?.[1]
    expect(b64).toBeTruthy()
    expect(Buffer.from(b64!, "base64").toString("utf8")).toContain('echo "$HOME"')
  })

  it("builds Ludus user bridge name", () => {
    expect(rangeBridgeName(2)).toBe("vmbr1002")
  })

  it("detects SO from range config", () => {
    expect(
      rangeConfigNeedsSoSniff(`
roles:
  - name: ludus_securityonion
`),
    ).toBe(true)
    expect(rangeConfigNeedsSoSniff(`template: securityonion-2.4-x64-template`)).toBe(true)
    expect(rangeConfigNeedsSoSniff(`vm_name: "{{ range_id }}-so"`)).toBe(true)
    expect(rangeConfigNeedsSoSniff(`template: debian-12-x64-server-template`)).toBe(false)
  })

  it("detects SO VM names", () => {
    expect(isSoVmName("JD-so", "JD")).toBe(true)
    expect(isSoVmName("foo-so")).toBe(true)
    expect(isSoVmName("JD-kali", "JD")).toBe(false)
  })

  it("matches sniff net1 convention", () => {
    const spec = sniffNetSpec("vmbr1002", 10)
    expect(net1LooksLikeSniff(spec, "vmbr1002", 10)).toBe(true)
    expect(net1LooksLikeSniff(`virtio,bridge=vmbr1002,tag=10,firewall=0`, "vmbr1002", 10)).toBe(
      true,
    )
    expect(net1LooksLikeSniff(`virtio,bridge=vmbr1002,tag=10,firewall=1`, "vmbr1002", 10)).toBe(
      false,
    )
  })
})
