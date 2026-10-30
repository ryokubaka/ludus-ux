import { describe, expect, it } from "vitest"
import { withoutGoadListEntries } from "@/lib/goad/goad-instance-list-cache"

const mini = { instanceId: "1a68f2-goad-mini-ludus", ludusRangeId: "snowden-DRACARYS-7861VB" }
const light = { instanceId: "689d32-goad-light-ludus", ludusRangeId: "snowden-GOAD-Light-ATNHLB" }

describe("withoutGoadListEntries", () => {
  it("removes a deleted range from the admin array and the user list object", () => {
    expect(withoutGoadListEntries([mini, light], { rangeId: mini.ludusRangeId })).toEqual([light])
    expect(
      withoutGoadListEntries(
        { configured: true, instances: [mini, light], error: null },
        { instanceId: mini.instanceId },
      ),
    ).toEqual({ configured: true, instances: [light], error: null })
  })

  it("leaves an unrelated cache value alone", () => {
    expect(withoutGoadListEntries({ tasks: [mini] }, { instanceId: mini.instanceId })).toEqual({
      tasks: [mini],
    })
    expect(withoutGoadListEntries([mini, "not-an-instance"], { instanceId: mini.instanceId })).toEqual([
      mini,
      "not-an-instance",
    ])
  })
})
