import type { LogHistoryEntry } from "@/lib/types"

/** GOAD task row shape used for Ludus deploy log correlation (dashboard, logs page, instance history). */
export interface GoadTaskForCorrelation {
  id: string
  command: string
  instanceId?: string
  status: string
  startedAt: number
  endedAt?: number
  exitCode?: number
  lineCount: number
}

export interface CorrelatedHistoryEntry {
  deployEntry?: LogHistoryEntry
  /**
   * When set: the primary deploy plus absorbed follow-up deploys (e.g. a
   * `network`-tag firewall deploy). Detail view concatenates all range deploy
   * logs. Populated by {@link absorbNetworkFollowupDeploys}.
   */
  mergedBatchDeploys?: LogHistoryEntry[]
  goadTask?: GoadTaskForCorrelation
  sortTime: number
  kind: "goad_integrated" | "goad_only" | "ludus_only"
}

/** REPL flows that pair with a Ludus deploy on the same instance (overlap can be 0 while "Running"). */
export function taskMatchesIntegrationRepl(command: string): boolean {
  return /--repl\s+"[^"]*;\s*(provide|install_extension|provision_lab|provision_extension)\b/.test(command)
}

/**
 * Short human label for a GOAD task command — used by the Dashboard to describe
 * the currently-running provisioning flow ("Install extension", "Provision lab", …).
 * Falls back to `"Running"` when we can't recognise the REPL shape.
 */
export function goadTaskShortKind(command: string): string {
  const m = command.match(/--repl\s+"[^"]*;\s*(provide|install_extension|provision_lab|provision_extension)\b/)
  if (!m) return "Running"
  switch (m[1]) {
    case "provide":
      return "Provide"
    case "install_extension": {
      const n = parseInstallExtensionNames(command).length
      return n > 1 ? "Install extensions" : "Install extension"
    }
    case "provision_lab":
      return "Provision lab"
    case "provision_extension":
      return "Provision extension"
    default:
      return "Running"
  }
}

/**
 * Longer human label for a GOAD task command used in list views (includes the
 * extension name when present, e.g. `"Install extension: elk"`).
 * Mirrors `goadTaskShortKind` but is intended for prominent row titles.
 */
export function goadHistoryTitle(command: string): string {
  const installNames: string[] = []
  const installRe = /install_extension\s+([^\s;]+)/g
  let im: RegExpExecArray | null
  while ((im = installRe.exec(command)) !== null) {
    installNames.push(im[1])
  }
  if (installNames.length === 1) return `Install extension: ${installNames[0]}`
  if (installNames.length > 1) {
    const label = `Install extensions: ${installNames.join(", ")}`
    return label.length > 120 ? `${label.slice(0, 117)}…` : label
  }
  const mProvExt = command.match(/provision_extension\s+([^\s;]+)/)
  if (mProvExt) return `Re-provision extension: ${mProvExt[1]}`
  if (/;\s*provision_lab\b/.test(command)) return "Provision lab"
  if (/;\s*provide\b/.test(command)) return "Provide"
  if (command.length > 72) return `${command.slice(0, 69)}…`
  return command || "GOAD"
}

/** Row title for integrated history (multi-install → `Install extensions: …` from command). */
export function goadIntegratedRowTitle(entry: CorrelatedHistoryEntry): string {
  const task = entry.goadTask
  if (!task) return "GOAD"
  return goadHistoryTitle(task.command)
}

/** Worst Ludus deploy status across a batch (failure / running beat success). */
export function aggregateDeployStatuses(deploys: LogHistoryEntry[]): string {
  if (deploys.length === 0) return ""
  const lower = deploys.map((d) => (d.status || "").toLowerCase())
  if (lower.some((s) => s === "error" || s === "failed" || s === "failure")) return "error"
  if (lower.some((s) => s === "aborted")) return "aborted"
  if (lower.some((s) => s === "running" || s === "waiting")) return "running"
  if (lower.every((s) => s === "success")) return "success"
  return deploys[0]?.status ?? "unknown"
}

/**
 * Status badge variant + label for a goad_integrated history row — combines the
 * Ludus deploy status with the GOAD task status so the row reflects the worst
 * of the two (failure beats running beats success).
 */
export function integratedHistoryBadge(entry: CorrelatedHistoryEntry): {
  variant: "success" | "warning" | "destructive" | "secondary"
  label: string
} {
  const deploys =
    entry.mergedBatchDeploys && entry.mergedBatchDeploys.length > 0
      ? entry.mergedBatchDeploys
      : entry.deployEntry
        ? [entry.deployEntry]
        : []
  const ds = aggregateDeployStatuses(deploys).toLowerCase()
  const ts = (entry.goadTask?.status ?? "").toLowerCase()
  const bad = (s: string) => s === "error" || s === "failed" || s === "failure"
  if (ts === "aborted" || ds === "aborted") return { variant: "secondary", label: "Aborted" }
  if (bad(ds) || bad(ts)) return { variant: "destructive", label: "Failed" }
  if (ds === "running" || ts === "running") return { variant: "warning", label: "Running" }
  return { variant: "success", label: "Done" }
}

const PROXIMITY_LINK_MS = 5 * 60 * 1000

/** Ordered extension names from a GOAD `--repl` command (multiple `install_extension` lines). */
export function parseInstallExtensionNames(command: string): string[] {
  const names: string[] = []
  const re = /install_extension\s+([^\s;]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(command)) !== null) {
    names.push(m[1])
  }
  return names
}

/** True when Ludus history `template` is a single-tag `network` deploy (firewall follow-up). */
export function isNetworkOnlyTagDeploy(d: LogHistoryEntry): boolean {
  const raw = (d.template || "").trim()
  if (!raw) return false
  const parts = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  return parts.length === 1 && parts[0] === "network"
}

/** Max gap between a GOAD task ending and the network follow-up deploy starting. */
const NETWORK_FOLLOWUP_MAX_GAP_MS = 2 * 60 * 1000

/**
 * Fold tag-scoped `network` Ludus deploy rows into the integrated install row
 * they follow (same GOAD session), so auto `deployRange(["network"])` does not
 * look like an unrelated range deploy.
 *
 * Handles both completed and still-running network deploys:
 * - Completed: matched by template === "network"
 * - In-progress: template may be empty — matched by time proximity to a
 *   recently-finished GOAD task (within {@link NETWORK_FOLLOWUP_MAX_GAP_MS}).
 */
function absorbNetworkFollowupDeploys(entries: CorrelatedHistoryEntry[]): CorrelatedHistoryEntry[] {
  const isNetworkCandidate = (e: CorrelatedHistoryEntry): boolean => {
    if (e.kind !== "ludus_only" || !e.deployEntry) return false
    if (isNetworkOnlyTagDeploy(e.deployEntry)) return true
    const d = e.deployEntry
    const running = (d.status || "").toLowerCase() === "running"
    const emptyTemplate = !d.template || d.template.trim() === ""
    return running && emptyTemplate
  }

  const orphans = entries.filter(isNetworkCandidate)
  if (orphans.length === 0) return entries

  let out = [...entries]
  for (const orphan of orphans) {
    const d = orphan.deployEntry!
    const dStart = new Date(d.start).getTime()
    const hasTemplate = isNetworkOnlyTagDeploy(d)

    let bestIdx = -1
    let bestScore = -Infinity
    for (let idx = 0; idx < out.length; idx++) {
      const e = out[idx]
      if (e.kind !== "goad_integrated" || !e.goadTask) continue
      const t = e.goadTask
      if (!taskMatchesIntegrationRepl(t.command)) continue
      if (dStart + 2000 < t.startedAt) continue

      if (hasTemplate) {
        if (t.startedAt > bestScore) {
          bestScore = t.startedAt
          bestIdx = idx
        }
      } else {
        const tEnd = t.endedAt ?? Date.now()
        const gap = dStart - tEnd
        if (gap >= 0 && gap <= NETWORK_FOLLOWUP_MAX_GAP_MS && tEnd > bestScore) {
          bestScore = tEnd
          bestIdx = idx
        }
      }
    }

    if (bestIdx < 0) continue

    const target = out[bestIdx]
    const batchBase =
      target.mergedBatchDeploys && target.mergedBatchDeploys.length > 0
        ? [...target.mergedBatchDeploys]
        : target.deployEntry
          ? [target.deployEntry]
          : []
    const merged = [...batchBase, d].sort(
      (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
    )
    const seen = new Set<string>()
    const unique = merged.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)))

    out[bestIdx] = {
      ...target,
      deployEntry: unique[0],
      mergedBatchDeploys: unique.length > 1 ? unique : undefined,
      sortTime: Math.max(target.sortTime, dStart),
    }
    out = out.filter((e) => e !== orphan)
  }

  return out
}


/**
 * Find the GOAD task that best correlates with a single Ludus deploy log entry.
 * `tasks` should already be filtered to the workspace instance.
 */
export function findCorrelatedGoadTask(
  deploy: LogHistoryEntry,
  tasks: GoadTaskForCorrelation[],
): GoadTaskForCorrelation | undefined {
  const dStart = new Date(deploy.start).getTime()
  const dEnd = new Date(deploy.end).getTime() || Date.now()

  let bestOverlapTask: GoadTaskForCorrelation | undefined
  let bestOverlap = 0
  let bestProxTask: GoadTaskForCorrelation | undefined
  let bestProxDist = Infinity

  for (const task of tasks) {
    const tEnd = task.endedAt ?? Date.now()
    const overlapStart = Math.max(dStart, task.startedAt)
    const overlapEnd = Math.min(dEnd, tEnd)
    const overlap = Math.max(0, overlapEnd - overlapStart)
    if (overlap > bestOverlap) {
      bestOverlap = overlap
      bestOverlapTask = task
    }
    if (overlap === 0 && taskMatchesIntegrationRepl(task.command)) {
      const dist = Math.min(
        Math.abs(dStart - task.startedAt),
        Math.abs(dEnd - task.startedAt),
      )
      if (dist < PROXIMITY_LINK_MS && dist < bestProxDist) {
        bestProxDist = dist
        bestProxTask = task
      }
    }
  }

  return bestOverlap > 0 ? bestOverlapTask : bestProxTask
}

export function correlateHistoryEntries(
  deployHistory: LogHistoryEntry[],
  goadTasks: GoadTaskForCorrelation[],
): CorrelatedHistoryEntry[] {
  const usedTaskIds = new Set<string>()
  const correlated: CorrelatedHistoryEntry[] = []

  for (const deploy of deployHistory) {
    const dStart = new Date(deploy.start).getTime()
    const dEnd = new Date(deploy.end).getTime() || Date.now()

    let bestOverlapTask: GoadTaskForCorrelation | undefined
    let bestOverlap = 0
    let bestProxTask: GoadTaskForCorrelation | undefined
    let bestProxDist = Infinity

    for (const task of goadTasks) {
      if (usedTaskIds.has(task.id)) continue
      const tEnd = task.endedAt ?? Date.now()
      const overlapStart = Math.max(dStart, task.startedAt)
      const overlapEnd = Math.min(dEnd, tEnd)
      const overlap = Math.max(0, overlapEnd - overlapStart)
      if (overlap > bestOverlap) {
        bestOverlap = overlap
        bestOverlapTask = task
      }
      if (overlap === 0 && taskMatchesIntegrationRepl(task.command)) {
        const dist = Math.min(
          Math.abs(dStart - task.startedAt),
          Math.abs(dEnd - task.startedAt),
        )
        if (dist < PROXIMITY_LINK_MS && dist < bestProxDist) {
          bestProxDist = dist
          bestProxTask = task
        }
      }
    }

    const bestTask = bestOverlap > 0 ? bestOverlapTask : bestProxTask
    if (bestTask) usedTaskIds.add(bestTask.id)

    correlated.push({
      deployEntry: deploy,
      goadTask: bestTask,
      sortTime: dStart,
      kind: bestTask ? "goad_integrated" : "ludus_only",
    })
  }

  for (const task of goadTasks) {
    if (!usedTaskIds.has(task.id)) {
      correlated.push({
        goadTask: task,
        sortTime: task.startedAt,
        kind: "goad_only",
      })
    }
  }

  const folded = absorbNetworkFollowupDeploys(correlated)
  folded.sort((a, b) => b.sortTime - a.sortTime)
  return folded
}
