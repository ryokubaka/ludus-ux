import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import {
  fetchAllCollectionVersions,
  parseArtifactFqcn,
  searchGalaxyCollections,
} from "./ansible-galaxy-api"

describe("ansible-galaxy-api", () => {
  it("parses namespace.name FQCN", () => {
    expect(parseArtifactFqcn("community.windows")).toEqual({
      namespace: "community",
      name: "windows",
    })
    expect(parseArtifactFqcn("not-fqcn")).toBeNull()
  })

  describe("searchGalaxyCollections", () => {
    beforeEach(() => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL) => {
          const url = String(input)

          if (url.includes("/collections/index/community/windows/versions/")) {
            return new Response(
              JSON.stringify({
                meta: { count: 3 },
                data: [{ version: "3.2.0" }, { version: "3.1.0" }, { version: "3.0.0" }],
              }),
              { status: 200 },
            )
          }

          if (url.includes("/collections/index/community/windows/")) {
            return new Response(
              JSON.stringify({
                namespace: "community",
                name: "windows",
                download_count: 1000,
                highest_version: { version: "3.2.0" },
              }),
              { status: 200 },
            )
          }

          if (url.includes("/collections/index/?") && url.includes("name=windows")) {
            return new Response(
              JSON.stringify({
                meta: { count: 2 },
                data: [
                  {
                    namespace: "community",
                    name: "windows",
                    download_count: 1000,
                    highest_version: { version: "3.2.0" },
                  },
                  {
                    namespace: "ansible",
                    name: "windows",
                    download_count: 2000,
                    highest_version: { version: "3.6.1" },
                  },
                ],
              }),
              { status: 200 },
            )
          }

          if (url.includes("/ansible.windows/versions/")) {
            return new Response(
              JSON.stringify({
                meta: { count: 1 },
                data: [{ version: "3.6.1" }],
              }),
              { status: 200 },
            )
          }

          if (url.includes("/collections/index/ansible/windows/")) {
            return new Response(
              JSON.stringify({
                namespace: "ansible",
                name: "windows",
                download_count: 2000,
                highest_version: { version: "3.6.1" },
              }),
              { status: 200 },
            )
          }

          return new Response(JSON.stringify({}), { status: 404 })
        }),
      )
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it("resolves FQCN via collection index + full version list", async () => {
      const items = await searchGalaxyCollections("community.windows")
      expect(items.map((i) => i.version)).toEqual(["3.2.0", "3.1.0", "3.0.0"])
      expect(items.every((i) => i.name === "community.windows")).toBe(true)
    })

    it("searches collection name via index and hydrates all versions per hit", async () => {
      const items = await searchGalaxyCollections("windows")
      const grouped = new Map<string, string[]>()
      for (const item of items) {
        const list = grouped.get(item.name) ?? []
        if (item.version) list.push(item.version)
        grouped.set(item.name, list)
      }
      expect(grouped.get("ansible.windows")).toEqual(["3.6.1"])
      expect(grouped.get("community.windows")).toEqual(["3.2.0", "3.1.0", "3.0.0"])
    })
  })

  describe("fetchAllCollectionVersions", () => {
    beforeEach(() => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL) => {
          const url = String(input)
          if (url.includes("offset=0")) {
            return new Response(
              JSON.stringify({
                meta: { count: 3 },
                data: [{ version: "2.0.0" }, { version: "1.0.0" }],
              }),
              { status: 200 },
            )
          }
          if (url.includes("offset=2")) {
            return new Response(
              JSON.stringify({
                meta: { count: 3 },
                data: [{ version: "0.9.0" }],
              }),
              { status: 200 },
            )
          }
          return new Response(JSON.stringify({}), { status: 404 })
        }),
      )
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it("paginates version list", async () => {
      const versions = await fetchAllCollectionVersions("community", "general")
      expect(versions).toEqual(["2.0.0", "1.0.0", "0.9.0"])
    })
  })
})
