import { describe, expect, it } from "vitest"
import { extractLudusList, parseLudusGroupList } from "./utils"

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

describe("extractLudusList", () => {
  it("unwraps typed Ludus list keys", () => {
    const row = { name: "debian12" }
    expect(extractLudusList(null)).toEqual([])
    expect(extractLudusList([row])).toEqual([row])
    expect(extractLudusList({ result: [row] })).toEqual([row])
    expect(extractLudusList({ blueprints: [row] })).toEqual([row])
    expect(extractLudusList({ templates: [row] })).toEqual([row])
  })
})
