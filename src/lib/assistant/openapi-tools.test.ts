import { describe, expect, it } from "vitest"
import {
  isDestructiveOperation,
  filterOperations,
  buildRequestPath,
  findOperation,
  loadLuxOpenApiOperations,
  mergeOpsWithCatalog,
  normalizeLudusCallArgs,
  type OpenApiOperation,
} from "./openapi-tools"
import { LUDUS_OPS_CATALOG } from "./ludus-ops-catalog"

describe("isDestructiveOperation", () => {
  it("flags DELETE", () => {
    expect(isDestructiveOperation("delete", "/users/{id}")).toBe(true)
  })

  it("flags deploy POST", () => {
    expect(isDestructiveOperation("post", "/range/deploy")).toBe(true)
  })

  it("flags Packer template build POST", () => {
    expect(isDestructiveOperation("post", "/templates")).toBe(true)
    expect(isDestructiveOperation("post", "/templates/abort")).toBe(true)
    expect(isDestructiveOperation("get", "/templates")).toBe(false)
  })
})

describe("filterOperations / findOperation", () => {
  const ops: OpenApiOperation[] = [
    {
      operationId: "deployRange",
      method: "post",
      path: "/range/deploy",
      summary: "Deploy",
      destructive: true,
      tags: ["range"],
    },
    {
      operationId: "getRange",
      method: "get",
      path: "/range",
      summary: "Status",
      destructive: false,
    },
    {
      operationId: "powerOffRange",
      method: "put",
      path: "/range/poweroff",
      summary: "Power off",
      destructive: true,
      tags: ["power"],
    },
    {
      operationId: "powerOnRange",
      method: "put",
      path: "/range/poweron",
      summary: "Power on",
      destructive: true,
      tags: ["power"],
    },
  ]

  it("filters by query", () => {
    expect(filterOperations(ops, "deploy").map((o) => o.operationId)).toEqual(["deployRange"])
  })

  it("expands power synonyms", () => {
    expect(filterOperations(ops, "power").map((o) => o.operationId).sort()).toEqual([
      "powerOffRange",
      "powerOnRange",
    ])
    expect(filterOperations(ops, "off").some((o) => o.operationId === "powerOffRange")).toBe(true)
    expect(filterOperations(ops, "shutdown").some((o) => o.operationId === "powerOffRange")).toBe(true)
  })

  it("finds by operationId case-insensitive", () => {
    expect(findOperation(ops, "GetRange")?.path).toBe("/range")
  })

  it("finds power aliases", () => {
    expect(findOperation(ops, "powerOff")?.operationId).toBe("powerOffRange")
    expect(findOperation(ops, "powerOn")?.operationId).toBe("powerOnRange")
  })

  it("finds by METHOD path (common model mistake)", () => {
    expect(findOperation(ops, "POST /range/deploy")?.operationId).toBe("deployRange")
    expect(findOperation(ops, "get /range")?.operationId).toBe("getRange")
  })

  it("finds unique path-only", () => {
    expect(findOperation(ops, "/range/deploy")?.operationId).toBe("deployRange")
  })
})

describe("mergeOpsWithCatalog / normalizeLudusCallArgs", () => {
  it("fills power ops when live openapi is sparse", () => {
    const live: OpenApiOperation[] = [
      {
        operationId: "getVersion",
        method: "get",
        path: "/",
        summary: "version",
        destructive: false,
      },
    ]
    const merged = mergeOpsWithCatalog(live, LUDUS_OPS_CATALOG)
    expect(merged.find((o) => o.operationId === "powerOffRange")?.path).toBe("/range/poweroff")
    expect(merged.find((o) => o.operationId === "powerOnRange")?.path).toBe("/range/poweron")
    expect(merged.find((o) => o.operationId === "listSnapshots")).toBeTruthy()
    expect(merged.find((o) => o.operationId === "startTesting")).toBeTruthy()
  })

  it("normalizes power args from pathParams to query.rangeID + machines all", () => {
    const op = LUDUS_OPS_CATALOG.find((o) => o.operationId === "powerOffRange")!
    const next = normalizeLudusCallArgs(op, {
      operationId: "powerOffRange",
      pathParams: { rangeId: "catshadowstep" },
    })
    expect(next.query).toEqual({ rangeID: "catshadowstep" })
    expect(next.body).toEqual({ machines: ["all"] })
    expect(next.pathParams).toBeUndefined()
  })
})

describe("buildRequestPath", () => {
  it("substitutes pathParams", () => {
    expect(buildRequestPath("/users/{userID}", { pathParams: { userID: "user-a" } })).toBe("/users/user-a")
  })
})

describe("loadLuxOpenApiOperations", () => {
  it("loads shipped docs/openapi.yaml", () => {
    const ops = loadLuxOpenApiOperations()
    expect(ops.length).toBeGreaterThan(10)
    expect(ops.some((o) => o.path.includes("/api/goad") || o.path.includes("/api/assistant"))).toBe(true)
  })

  it("includes template add-from-source operations", () => {
    const ops = loadLuxOpenApiOperations()
    expect(ops.find((o) => o.operationId === "listTemplateSources")?.path).toBe("/api/templates/sources")
    expect(ops.find((o) => o.operationId === "addTemplates")?.path).toBe("/api/templates/add")
    expect(ops.find((o) => o.operationId === "addTemplates")?.callHints).toMatch(/templates/)
    expect(ops.find((o) => o.operationId === "addTemplates")?.summary).toMatch(/does NOT run Packer/i)
    expect(ops.find((o) => o.operationId === "addTemplates")?.callHints).toMatch(/buildTemplates/)
    expect(findOperation(ops, "GET /api/templates/sources")?.operationId).toBe("listTemplateSources")
    expect(findOperation(ops, "listTemplateSources")?.path).toBe("/api/templates/sources")
  })

  it("includes catalog routes missing from sparse openapi (sources, goad handoff)", () => {
    const ops = loadLuxOpenApiOperations()
    expect(ops.some((o) => o.path === "/api/sources" || o.path.startsWith("/api/sources/"))).toBe(true)
    expect(ops.some((o) => o.path === "/api/goad/deploy-handoff")).toBe(true)
    expect(ops.find((o) => o.operationId === "executeGoad")?.path).toBe("/api/goad/execute")
  })
})
