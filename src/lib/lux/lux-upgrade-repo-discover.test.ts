import { describe, expect, it, vi, afterEach } from "vitest"
import { clientRepoHintsFromInspect, luxRepoPathCandidatesFromInspect } from "@/lib/lux/lux-upgrade-docker"

describe("luxRepoPathCandidatesFromInspect", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("prefers /app/data mount parent over Compose working_dir", () => {
    const candidates = luxRepoPathCandidatesFromInspect({
      Config: {
        Labels: { "com.docker.compose.project.working_dir": "/opt/ludus-ux" },
      },
      Mounts: [
        {
          Destination: "/app/data",
          Source: "E:/gitlab/ludus-ux/data",
        },
      ],
    })
    expect(candidates[0]).toBe("E:/gitlab/ludus-ux")
  })

  it("collects raw client paths for host translation", () => {
    expect(
      clientRepoHintsFromInspect({
        Config: { Labels: { "com.docker.compose.project.working_dir": "E:\\gitlab\\ludus-ux" } },
        Mounts: [{ Destination: "/app/data", Source: "E:/gitlab/ludus-ux/data" }],
      }),
    ).toEqual(["E:/gitlab/ludus-ux/data", "E:\\gitlab\\ludus-ux"])
  })
})
