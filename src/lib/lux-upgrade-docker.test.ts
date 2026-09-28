import { describe, expect, it } from "vitest"
import { buildHostExecContainer } from "./lux-upgrade-docker"

describe("lux-upgrade-docker", () => {
  it("enters the host namespaces and runs the script unchanged", () => {
    const script = "printf 'repo=%s\\n' '/opt/ludus-ux'"
    const spec = buildHostExecContainer(script)
    expect(spec.Image).toBe("node:24-alpine")
    expect(spec.Entrypoint.slice(0, 4)).toEqual(["/usr/bin/nsenter", "-t", "1", "-w/"])
    expect(spec.Entrypoint).toContain("-p")
    expect(spec.Cmd).toEqual([script])
    expect(spec.HostConfig).toEqual({ Privileged: true, PidMode: "host" })
  })
})