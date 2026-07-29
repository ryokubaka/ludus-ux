import { describe, expect, it } from "vitest"
import {
  LUDUS_DEFAULT_ROUTER_TEMPLATE,
  checkRouterTemplateBuilt,
  withRouterTemplateRequired,
} from "./ludus-router-template"

describe("ludus-router-template", () => {
  it("exports debian-11 default", () => {
    expect(LUDUS_DEFAULT_ROUTER_TEMPLATE).toBe("debian-11-x64-server-template")
  })

  it("withRouterTemplateRequired prepends once", () => {
    expect(withRouterTemplateRequired(["win2019-server-x64-template"])).toEqual([
      "debian-11-x64-server-template",
      "win2019-server-x64-template",
    ])
    expect(
      withRouterTemplateRequired(["debian-11-x64-server-template", "win2019-server-x64-template"]),
    ).toEqual(["debian-11-x64-server-template", "win2019-server-x64-template"])
  })

  it("checkRouterTemplateBuilt missing / need_build / ok", () => {
    expect(checkRouterTemplateBuilt(new Map()).ok).toBe(false)
    expect(checkRouterTemplateBuilt(new Map([[LUDUS_DEFAULT_ROUTER_TEMPLATE, false]])).ok).toBe(
      false,
    )
    const ok = checkRouterTemplateBuilt(new Map([[LUDUS_DEFAULT_ROUTER_TEMPLATE, true]]))
    expect(ok.ok).toBe(true)
  })
})
