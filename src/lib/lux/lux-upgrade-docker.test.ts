import { afterEach, describe, expect, it } from "vitest"
import { buildHostExecContainer, dockerApiVersion } from "@/lib/lux/lux-upgrade-docker"

describe("lux-upgrade-docker", () => {
  const prevApi = process.env.LUX_DOCKER_API_VERSION
  afterEach(() => {
    if (prevApi === undefined) delete process.env.LUX_DOCKER_API_VERSION
    else process.env.LUX_DOCKER_API_VERSION = prevApi
  })

  it("enters the host namespaces and runs the script unchanged", () => {
    const script = "printf 'repo=%s\\n' '/opt/ludus-ux'"
    const spec = buildHostExecContainer(script, "sha256:lux")
    expect(spec.Image).toBe("sha256:lux")
    expect(spec.Entrypoint).toEqual([
      "/usr/bin/nsenter",
      "-t",
      "1",
      "-m",
      "-u",
      "-i",
      "-n",
      "-p",
      "--",
      "/usr/bin/env",
      "-C",
      "/",
      "/bin/sh",
      "-c",
    ])
    expect(spec.Cmd).toEqual([script])
    expect(spec.HostConfig).toEqual({ Privileged: true, PidMode: "host", CgroupnsMode: "host" })
  })

  it("defaults to a Docker API version Engine 24 accepts", () => {
    delete process.env.LUX_DOCKER_API_VERSION
    expect(dockerApiVersion()).toBe("v1.43")
    process.env.LUX_DOCKER_API_VERSION = "1.41"
    expect(dockerApiVersion()).toBe("v1.41")
  })
})