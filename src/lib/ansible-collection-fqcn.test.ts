import { describe, expect, it } from "vitest"
import { parseGalaxyCollectionFqcn } from "@/lib/ansible-collection-fqcn"

describe("parseGalaxyCollectionFqcn", () => {
  it("reads namespace and name from galaxy.yml", () => {
    const yaml = `---
namespace: badsectorlabs
name: ludus_windows_utils
version: 1.2.0
`
    expect(parseGalaxyCollectionFqcn(yaml)).toBe("badsectorlabs.ludus_windows_utils")
  })
})
