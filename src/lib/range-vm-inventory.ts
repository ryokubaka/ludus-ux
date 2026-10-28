import yaml from "js-yaml"
import {
  ludusDefaultRouterVmName,
  resolveRangeIdInHost,
} from "@/lib/ludus-deploy-limit"
import { isLudusRangeRouterVmName } from "@/lib/ludus-range-router-vm"
import {
  inferRouterTemplateFromVmName,
  resolveRequiredRouterTemplateFromConfig,
} from "@/lib/ludus-router-template"
import { templateDirNameAliases } from "@/lib/template-packer-paths"
import type { RangeObject, VMObject } from "@/lib/types"

export interface RangeVmInventoryRow {
  vmName: string
  proxmoxID: number
  ip: string
  poweredOn: boolean
  rangeID: string
  rangeName: string
  rangeState: string
  ownerUserID: string
  template: string
  isRouter: boolean
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function scalarString(value: unknown): string {
  if (value == null) return ""
  return (typeof value === "string" ? value : String(value)).trim()
}

function addVmTemplateEntry(
  map: Map<string, string>,
  vmNameRaw: string,
  templateRaw: string,
  rangeId: string,
): void {
  const vmName = rangeId ? resolveRangeIdInHost(vmNameRaw, rangeId) : vmNameRaw.trim()
  const template = templateRaw.trim()
  if (!vmName || !template) return
  map.set(vmName, template)
}

function collectFromVmList(
  list: unknown,
  map: Map<string, string>,
  rangeId: string,
): void {
  if (!Array.isArray(list)) return
  for (const vm of list) {
    const rec = asRecord(vm)
    if (!rec) continue
    addVmTemplateEntry(map, scalarString(rec.vm_name), scalarString(rec.template), rangeId)
  }
}

/** Map deployed Proxmox vm_name → Packer template from range-config YAML. */
export function parseVmTemplateMapFromConfig(yamlText: string, rangeId: string): Map<string, string> {
  const map = new Map<string, string>()
  if (!yamlText.trim()) return map

  let doc: unknown
  try {
    doc = yaml.load(yamlText)
  } catch {
    return map
  }

  const root = asRecord(doc)
  if (!root) return map

  collectFromVmList(root.ludus, map, rangeId)
  collectFromVmList(root.ludus_non_domain, map, rangeId)

  const router = asRecord(root.router)
  if (router) {
    const routerVmNameRaw = scalarString(router.vm_name)
    const routerVmName = routerVmNameRaw || ludusDefaultRouterVmName(rangeId)
    const routerTemplate =
      scalarString(router.template) ||
      (routerVmNameRaw ? inferRouterTemplateFromVmName(routerVmNameRaw) : null) ||
      resolveRequiredRouterTemplateFromConfig({}).template
    addVmTemplateEntry(map, routerVmName, routerTemplate, rangeId)
  }

  return map
}

export function vmMatchesTemplateFilter(rowTemplate: string, filterTemplate: string): boolean {
  const row = rowTemplate.trim()
  const filter = filterTemplate.trim()
  if (!filter) return true
  if (!row || row === "—") return false

  const rowAliases = new Set(templateDirNameAliases(row).map((a) => a.toLowerCase()))
  const filterAliases = templateDirNameAliases(filter)
  return filterAliases.some((alias) => rowAliases.has(alias.toLowerCase()))
}

export function buildRangeVmInventoryRows(
  ranges: RangeObject[],
  configsByRangeId: Record<string, string>,
  ownership: Record<string, string>,
): RangeVmInventoryRow[] {
  const rows: RangeVmInventoryRow[] = []

  for (const range of ranges) {
    const vms = range.VMs || []
    if (vms.length === 0) continue

    const templateMap = parseVmTemplateMapFromConfig(
      configsByRangeId[range.rangeID] || "",
      range.rangeID,
    )
    const ownerUserID = ownership[range.rangeID] || range.userID || ""

    for (const vm of vms) {
      rows.push(buildInventoryRow(vm, range, templateMap, ownerUserID))
    }
  }

  return rows.sort((a, b) => {
    const rangeCmp = a.rangeID.localeCompare(b.rangeID)
    if (rangeCmp !== 0) return rangeCmp
    return a.vmName.localeCompare(b.vmName)
  })
}

function buildInventoryRow(
  vm: VMObject,
  range: RangeObject,
  templateMap: Map<string, string>,
  ownerUserID: string,
): RangeVmInventoryRow {
  const vmName = vm.name?.trim() || ""
  const template = templateMap.get(vmName) || "—"
  return {
    vmName,
    proxmoxID: vm.proxmoxID,
    ip: vm.ip || "",
    poweredOn: Boolean(vm.poweredOn),
    rangeID: range.rangeID,
    rangeName: range.name || range.rangeID,
    rangeState: range.rangeState || "",
    ownerUserID,
    template,
    isRouter: isLudusRangeRouterVmName(vmName),
  }
}

export function inventoryRowToVmObject(row: RangeVmInventoryRow): VMObject {
  return {
    ID: row.proxmoxID,
    proxmoxID: row.proxmoxID,
    rangeNumber: 0,
    name: row.vmName,
    poweredOn: row.poweredOn,
    ip: row.ip,
  }
}

/** Group inventory rows by range for Ludus power APIs (machines must share a range). */
export function groupInventoryRowsByRange(
  rows: RangeVmInventoryRow[],
): Map<string, RangeVmInventoryRow[]> {
  const map = new Map<string, RangeVmInventoryRow[]>()
  for (const row of rows) {
    const list = map.get(row.rangeID) ?? []
    list.push(row)
    map.set(row.rangeID, list)
  }
  return map
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return []
  const results: R[] = new Array(items.length)
  let index = 0

  async function worker(): Promise<void> {
    while (index < items.length) {
      const i = index++
      results[i] = await fn(items[i])
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}
