import type { GoadCatalog } from "@/lib/types"

/** GOAD skips `ludus range deploy` on `install_extension` when the extension adds no VMs. */
export function goadSupportsProvisionOnlyExtensions(
  catalog: GoadCatalog | null | undefined,
): boolean {
  return catalog?.capabilities?.provisionOnlyExtensions === true
}

export function extensionIsProvisionOnly(ext: { machines: string[] }): boolean {
  return ext.machines.length === 0
}
