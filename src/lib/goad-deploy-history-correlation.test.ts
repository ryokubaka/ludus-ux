import { describe, expect, it } from "vitest"
import {
  taskMatchesIntegrationRepl,
  goadTaskShortKind,
  goadHistoryTitle,
  goadIntegratedRowTitle,
  aggregateDeployStatuses,
  integratedHistoryBadge,
  parseInstallExtensionNames,
  isNetworkOnlyTagDeploy,
  findCorrelatedGoadTask,
  correlateHistoryEntries,
  type GoadTaskForCorrelation,
  type CorrelatedHistoryEntry,
} from "./goad-deploy-history-correlation"
import type { LogHistoryEntry } from "./types"

function makeTask(overrides: Partial<GoadTaskForCorrelation> = {}): GoadTaskForCorrelation {
  return {
    id: "task-1",
    command: '--repl "use GOAD; provide; install"',
    status: "done",
    startedAt: 1000,
    endedAt: 5000,
    lineCount: 100,
    ...overrides,
  }
}

function makeLogEntry(overrides: Partial<LogHistoryEntry> = {}): LogHistoryEntry {
  return {
    id: "log-1",
    template: "",
    status: "success",
    start: new Date(2000).toISOString(),
    end: new Date(6000).toISOString(),
    created: new Date(2000).toISOString(),
    ...overrides,
  }
}

describe("taskMatchesIntegrationRepl", () => {
  it("matches provide REPL command", () => {
    expect(taskMatchesIntegrationRepl('--repl "use GOAD; provide"')).toBe(true)
  })

  it("matches install_extension REPL command", () => {
    expect(taskMatchesIntegrationRepl('--repl "use GOAD; install_extension elk"')).toBe(true)
  })

  it("does not match non-REPL commands", () => {
    expect(taskMatchesIntegrationRepl("goad --help")).toBe(false)
  })
})

describe("goadTaskShortKind", () => {
  it("returns 'Install' for provide+provision_lab", () => {
    expect(goadTaskShortKind('--repl "use GOAD; provide; provision_lab"')).toBe("Install")
  })

  it("returns 'Provide' for provide REPL", () => {
    expect(goadTaskShortKind('--repl "use GOAD; provide"')).toBe("Provide")
  })

  it("returns 'Install extension' for single install_extension", () => {
    expect(goadTaskShortKind('--repl "use GOAD; install_extension elk"')).toBe("Install extension")
  })

  it("returns 'Install extensions' for multiple install_extension", () => {
    const cmd = '--repl "use GOAD; install_extension elk; install_extension sccm"'
    expect(goadTaskShortKind(cmd)).toBe("Install extensions")
  })

  it("returns 'Running' for unrecognised commands", () => {
    expect(goadTaskShortKind("some random command")).toBe("Running")
  })
})

describe("goadHistoryTitle", () => {
  it("returns extension name for single install_extension", () => {
    const cmd = '--repl "use GOAD; install_extension elk"'
    expect(goadHistoryTitle(cmd)).toBe("Install extension: elk")
  })

  it("returns comma-separated names for multiple install_extension", () => {
    const cmd = '--repl "use GOAD; install_extension elk; install_extension sccm"'
    expect(goadHistoryTitle(cmd)).toBe("Install extensions: elk, sccm")
  })

  it("returns Install for set_extensions + install", () => {
    expect(goadHistoryTitle('set_extensions goad; install')).toBe("Install (lab + extension: goad)")
  })

  it("truncates very long commands", () => {
    const cmd = "a".repeat(100)
    expect(goadHistoryTitle(cmd).length).toBeLessThanOrEqual(73)
  })

  it("returns 'GOAD' for empty command", () => {
    expect(goadHistoryTitle("")).toBe("GOAD")
  })
})

describe("goadIntegratedRowTitle", () => {
  it("returns title from goadTask command", () => {
    const entry: CorrelatedHistoryEntry = {
      goadTask: makeTask({ command: '--repl "use GOAD; provide"' }),
      sortTime: 1000,
      kind: "goad_integrated",
    }
    expect(goadIntegratedRowTitle(entry)).toBe("Provide")
  })

  it("returns 'GOAD' when no task", () => {
    const entry: CorrelatedHistoryEntry = {
      sortTime: 1000,
      kind: "goad_only",
    }
    expect(goadIntegratedRowTitle(entry)).toBe("GOAD")
  })
})

describe("aggregateDeployStatuses", () => {
  it("returns 'error' when any deploy failed", () => {
    const deploys = [
      makeLogEntry({ status: "success" }),
      makeLogEntry({ status: "error" }),
    ]
    expect(aggregateDeployStatuses(deploys)).toBe("error")
  })

  it("returns 'running' when any deploy is running", () => {
    const deploys = [
      makeLogEntry({ status: "success" }),
      makeLogEntry({ status: "running" }),
    ]
    expect(aggregateDeployStatuses(deploys)).toBe("running")
  })

  it("returns 'success' when all succeed", () => {
    const deploys = [
      makeLogEntry({ status: "success" }),
      makeLogEntry({ status: "success" }),
    ]
    expect(aggregateDeployStatuses(deploys)).toBe("success")
  })

  it("returns empty string for empty array", () => {
    expect(aggregateDeployStatuses([])).toBe("")
  })

  it("returns 'aborted' when any deploy is aborted", () => {
    const deploys = [
      makeLogEntry({ status: "success" }),
      makeLogEntry({ status: "aborted" }),
    ]
    expect(aggregateDeployStatuses(deploys)).toBe("aborted")
  })
})

describe("integratedHistoryBadge", () => {
  it("returns success for completed entries", () => {
    const entry: CorrelatedHistoryEntry = {
      deployEntry: makeLogEntry({ status: "success" }),
      goadTask: makeTask({ status: "done" }),
      sortTime: 1000,
      kind: "goad_integrated",
    }
    expect(integratedHistoryBadge(entry).variant).toBe("success")
  })

  it("returns destructive for failed entries", () => {
    const entry: CorrelatedHistoryEntry = {
      deployEntry: makeLogEntry({ status: "error" }),
      goadTask: makeTask({ status: "done" }),
      sortTime: 1000,
      kind: "goad_integrated",
    }
    expect(integratedHistoryBadge(entry).variant).toBe("destructive")
  })

  it("returns warning for running entries", () => {
    const entry: CorrelatedHistoryEntry = {
      goadTask: makeTask({ status: "running" }),
      sortTime: 1000,
      kind: "goad_integrated",
    }
    expect(integratedHistoryBadge(entry).variant).toBe("warning")
  })
})

describe("parseInstallExtensionNames", () => {
  it("extracts single extension name", () => {
    expect(parseInstallExtensionNames("install_extension elk")).toEqual(["elk"])
  })

  it("extracts multiple extension names", () => {
    expect(parseInstallExtensionNames("install_extension elk; install_extension sccm")).toEqual(["elk", "sccm"])
  })

  it("returns empty for no match", () => {
    expect(parseInstallExtensionNames("provide")).toEqual([])
  })
})

describe("isNetworkOnlyTagDeploy", () => {
  it("returns true for network-only template", () => {
    expect(isNetworkOnlyTagDeploy(makeLogEntry({ template: "network" }))).toBe(true)
  })

  it("returns false for multi-tag template", () => {
    expect(isNetworkOnlyTagDeploy(makeLogEntry({ template: "network, windows" }))).toBe(false)
  })

  it("returns false for empty template", () => {
    expect(isNetworkOnlyTagDeploy(makeLogEntry({ template: "" }))).toBe(false)
  })
})

describe("findCorrelatedGoadTask", () => {
  it("correlates by time overlap", () => {
    const deploy = makeLogEntry({
      start: new Date(1000).toISOString(),
      end: new Date(5000).toISOString(),
    })
    const tasks = [makeTask({ id: "t1", startedAt: 900, endedAt: 4000 })]
    const result = findCorrelatedGoadTask(deploy, tasks)
    expect(result?.id).toBe("t1")
  })

  it("returns undefined when no tasks overlap", () => {
    const deploy = makeLogEntry({
      start: new Date(1000).toISOString(),
      end: new Date(2000).toISOString(),
    })
    const tasks = [makeTask({ id: "t1", startedAt: 10000, endedAt: 20000, command: "goad --help" })]
    expect(findCorrelatedGoadTask(deploy, tasks)).toBeUndefined()
  })
})

describe("correlateHistoryEntries", () => {
  it("produces goad_integrated entries for overlapping deploy+task", () => {
    const deploy = makeLogEntry({
      id: "d1",
      start: new Date(1000).toISOString(),
      end: new Date(5000).toISOString(),
    })
    const task = makeTask({
      id: "t1",
      command: '--repl "use GOAD; provide"',
      startedAt: 900,
      endedAt: 4000,
    })
    const result = correlateHistoryEntries([deploy], [task])
    expect(result.some((e) => e.kind === "goad_integrated")).toBe(true)
  })

  it("produces goad_only entries for tasks without matching deploy", () => {
    const task = makeTask({
      id: "t1",
      command: "goad --version",
      startedAt: 100000,
      endedAt: 200000,
    })
    const result = correlateHistoryEntries([], [task])
    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe("goad_only")
  })

  it("produces ludus_only entries for deploys without matching task", () => {
    const deploy = makeLogEntry({ id: "d1" })
    const result = correlateHistoryEntries([deploy], [])
    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe("ludus_only")
  })

  it("sorts results newest-first", () => {
    const d1 = makeLogEntry({ id: "d1", start: new Date(1000).toISOString() })
    const d2 = makeLogEntry({ id: "d2", start: new Date(5000).toISOString() })
    const result = correlateHistoryEntries([d1, d2], [])
    expect(result[0].sortTime).toBeGreaterThanOrEqual(result[1].sortTime)
  })
})
