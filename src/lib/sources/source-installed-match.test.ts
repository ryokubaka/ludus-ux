import { describe, expect, it } from "vitest"
import type { RegisteredLudusSource } from "@/lib/sources/registered-ludus-sources"
import {
  buildAnsibleSourceMatchMap,
  lookupAnsibleSourceMatch,
} from "@/lib/sources/source-installed-match"

const sources: RegisteredLudusSource[] = [
  {
    id: "meow-main",
    name: "Ludus Source – Meow",
    ref: "main",
    url: "https://github.com/ryokubaka/ludus-source-meow",
  },
  {
    id: "meow-feat",
    name: "Ludus Source – Meow",
    ref: "feat/securityonion-3.3.0",
    url: "https://github.com/ryokubaka/ludus-source-meow",
  },
]

describe("buildAnsibleSourceMatchMap", () => {
  it("attributes a role to the branch whose catalog version matches the install", () => {
    const map = buildAnsibleSourceMatchMap(
      "role",
      [
        {
          sourceId: "meow-main",
          items: [{ sourceId: "meow-main", name: "ryokubaka.ludus_securityonion", version: "1.0.3" }],
        },
        {
          sourceId: "meow-feat",
          items: [{ sourceId: "meow-feat", name: "ryokubaka.ludus_securityonion", version: "1.1.0" }],
        },
      ],
      sources,
      [{ name: "ryokubaka.ludus_securityonion", version: "1.1.0" }],
    )
    const match = lookupAnsibleSourceMatch(map, "ryokubaka.ludus_securityonion")
    expect(match?.sourceId).toBe("meow-feat")
    expect(match?.upgradeAvailable).toBe(false)
    expect(match?.sourceLabel).toBe("Ludus Source – Meow · feat/securityonion-3.3.0")
  })

  it("keeps a role in sync when Ludus omits its version and the catalog has one", () => {
    const map = buildAnsibleSourceMatchMap(
      "role",
      [
        {
          sourceId: "meow-main",
          items: [{ sourceId: "meow-main", name: "whispergate.ludus_jenkins", version: "1.0.0" }],
        },
      ],
      sources,
      [{ name: "whispergate.ludus_jenkins" }],
    )
    const match = lookupAnsibleSourceMatch(map, "whispergate.ludus_jenkins")
    expect(match?.catalogVersion).toBe("1.0.0")
    expect(match?.installedVersion).toBeUndefined()
    expect(match?.upgradeAvailable).toBe(false)
  })
})
