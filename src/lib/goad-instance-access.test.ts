import { describe, expect, it } from "vitest"
import { decideGoadInstanceAccess, goadTargetInstanceIds, type GoadInstanceAccessFacts } from "./goad-instance-access"

function facts(over: Partial<GoadInstanceAccessFacts>): GoadInstanceAccessFacts {
  return {
    isAdmin: false,
    caller: "bob",
    workspaceOwner: "alice",
    hostUser: "ludus",
    latestTaskOwner: null,
    ...over,
  }
}

describe("decideGoadInstanceAccess", () => {
  it("lets an admin act on any instance", () => {
    expect(decideGoadInstanceAccess(facts({ isAdmin: true }))).toBe(true)
  })

  it("trusts a named workspace owner over any task", () => {
    expect(decideGoadInstanceAccess(facts({ caller: "Alice" }))).toBe(true)
    expect(decideGoadInstanceAccess(facts({ latestTaskOwner: "bob" }))).toBe(false)
    expect(decideGoadInstanceAccess(facts({ allowUnclaimed: true }))).toBe(false)
  })

  it("uses the newest task while the host account or root owns the workspace", () => {
    for (const workspaceOwner of ["ludus", "root", "1001", ""]) {
      expect(decideGoadInstanceAccess(facts({ workspaceOwner, latestTaskOwner: "alice" }))).toBe(false)
      expect(decideGoadInstanceAccess(facts({ workspaceOwner, latestTaskOwner: "bob" }))).toBe(true)
    }
  })

  it("lets the host account act on its own workspace", () => {
    expect(decideGoadInstanceAccess(facts({ caller: "ludus", workspaceOwner: "ludus" }))).toBe(true)
  })

  it("refuses an unclaimed or unlisted instance unless the caller is claiming it", () => {
    expect(decideGoadInstanceAccess(facts({ workspaceOwner: null }))).toBe(false)
    expect(decideGoadInstanceAccess(facts({ workspaceOwner: "ludus" }))).toBe(false)
    expect(decideGoadInstanceAccess(facts({ workspaceOwner: "ludus", allowUnclaimed: true }))).toBe(true)
    expect(decideGoadInstanceAccess(facts({ workspaceOwner: null, allowUnclaimed: true }))).toBe(true)
  })

  it("refuses an empty caller", () => {
    expect(decideGoadInstanceAccess(facts({ caller: " ", workspaceOwner: "" }))).toBe(false)
  })
})

describe("goadTargetInstanceIds", () => {
  it("collects the body instance and every REPL use line", () => {
    expect(goadTargetInstanceIds(`--repl "use a1-goad-mini;provide"`, undefined)).toEqual(["a1-goad-mini"])
    expect(goadTargetInstanceIds(`--repl "unload;use b2-lab;install_extension elk"`, "c3-lab")).toEqual(["c3-lab", "b2-lab"])
    expect(goadTargetInstanceIds("-t check -l GOAD-Mini -p ludus", null)).toEqual([])
  })
})
