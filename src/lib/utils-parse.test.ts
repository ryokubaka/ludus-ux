import { describe, expect, it } from "vitest"
import { parseLudusGroupList } from "./utils"

describe("parseLudusGroupList", () => {
  it("accepts arrays and Ludus wrapper shapes", () => {
    const row = { groupName: "lab-a" }
    expect(parseLudusGroupList(null)).toEqual([])
    expect(parseLudusGroupList([row])).toEqual([row])
    expect(parseLudusGroupList({ result: [row] })).toEqual([row])
    expect(parseLudusGroupList({ groups: [row] })).toEqual([row])
    expect(parseLudusGroupList({ items: [row] })).toEqual([row])
    expect(parseLudusGroupList({ result: row })).toEqual([row])
  })
})
