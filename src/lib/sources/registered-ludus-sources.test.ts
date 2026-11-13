import { describe, expect, it } from "vitest"
import {
  blueprintShortName,
  installedBlueprintMatchesSource,
  installedSourceRemoteMatches,
  mapRegisteredSources,
  registeredSourceLabel,
  sourceBlueprintInstallId,
  sourcesQueryRows,
  sourceIdsAreSameRegistration,
} from "@/lib/sources/registered-ludus-sources"

describe("sources query cache", () => {
  it("reads the shared { sources } shape and an older array write", () => {
    const objectRows = sourcesQueryRows({
      available: true,
      sources: [{ sourceID: "bsl", url: "https://example.com/bsl.git" }],
    })
    const arrayRows = sourcesQueryRows([{ id: "local", url: "https://example.com/local.git" }])
    expect(mapRegisteredSources(objectRows).map((source) => source.id)).toEqual(["bsl"])
    expect(mapRegisteredSources(arrayRows).map((source) => source.id)).toEqual(["local"])
    expect(sourcesQueryRows(undefined)).toEqual([])
    expect(sourcesQueryRows({ sources: "nope" })).toEqual([])
  })
})
