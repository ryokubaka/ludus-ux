import { describe, expect, it } from "vitest"
import { ansibleInventoryByKind, ansibleInventoryItems } from "@/lib/ansible-inventory"
import type { AnsibleItem } from "@/lib/types"

describe("ansible-inventory", () => {
  const roles: AnsibleItem[] = [{ name: "geerlingguy.docker", version: "7.1.0", type: "role" }]
  const collections: AnsibleItem[] = [
    { name: "community.general", version: "1.0.0", type: "collection" },
  ]

  it("prefers all when present", () => {
    expect(
      ansibleInventoryItems({ all: [...roles, ...collections], roles, collections }),
    ).toHaveLength(2)
  })

  it("falls back to roles+collections from SSR prefetch shape", () => {
    expect(ansibleInventoryItems({ roles, collections })).toEqual([...roles, ...collections])
  })

  it("filters inventory by kind", () => {
    expect(ansibleInventoryByKind({ roles, collections }, "role")).toEqual(roles)
    expect(ansibleInventoryByKind({ roles, collections }, "collection")).toEqual(collections)
  })
})
