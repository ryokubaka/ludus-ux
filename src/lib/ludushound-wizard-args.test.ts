import { describe, expect, it } from "vitest"
import {
  buildLudushoundArgv,
  buildLudushoundCommand,
  validateLudushoundArgs,
} from "./ludushound-wizard-args"

describe("ludushound-wizard-args", () => {
  it("validates full neo4j args", () => {
    expect(
      validateLudushoundArgs({
        mode: "full",
        source: "external",
        server: "10.0.0.5",
        user: "neo4j",
        pass: "x",
        aliveComputers: ["DC01.GHOST.LOCAL"],
        output: "/tmp/out.yml",
      }),
    ).toBeNull()
    expect(
      validateLudushoundArgs({
        mode: "full",
        source: "external",
        server: "",
        user: "neo4j",
        pass: "x",
        aliveComputers: ["DC01.GHOST.LOCAL"],
        output: "/tmp/out.yml",
      }),
    ).toMatch(/server/i)
  })

  it("builds attackpath argv", () => {
    const argv = buildLudushoundArgv({
      mode: "attackpath",
      attackPath: "/tmp/graph.json",
      domainController: "TITAN.GHOST.LOCAL",
      output: "/tmp/ap.yml",
      localRoles: true,
    })
    expect(argv).toEqual([
      "-LocalRoles",
      "-AttackPath",
      "/tmp/graph.json",
      "-DomainController",
      "TITAN.GHOST.LOCAL",
      "-Output",
      "/tmp/ap.yml",
    ])
  })

  it("builds shell command with quoted paths", () => {
    const cmd = buildLudushoundCommand("/opt/LudusHound", {
      mode: "full",
      source: "filesmap",
      filesMapJson: "/opt/LudusHound/workspaces/a/filesMap.json",
      aliveComputers: ["a.b.local", "c.d.local"],
      output: "/opt/LudusHound/workspaces/a/out.yml",
    })
    expect(cmd).toContain("cd '/opt/LudusHound'")
    expect(cmd).toContain("'/opt/LudusHound/LudusHound'")
    expect(cmd).toContain("-FilesMapJson")
    expect(cmd).toContain("a.b.local,c.d.local")
  })
})
