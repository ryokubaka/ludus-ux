import type { AnsibleItem } from "@/lib/types"

/** Normalize ansible query payloads from SSR prefetch, client fetch, or persisted cache. */
export function ansibleInventoryItems(
  data: { all?: AnsibleItem[]; roles?: AnsibleItem[]; collections?: AnsibleItem[] } | undefined,
): AnsibleItem[] {
  if (!data) return []
  if (data.all?.length) return data.all
  return [...(data.roles ?? []), ...(data.collections ?? [])]
}

export function ansibleInventoryByKind(
  data: { all?: AnsibleItem[]; roles?: AnsibleItem[]; collections?: AnsibleItem[] } | undefined,
  kind: "role" | "collection",
): AnsibleItem[] {
  return ansibleInventoryItems(data).filter((i) => (i.type || i.Type) === kind)
}
