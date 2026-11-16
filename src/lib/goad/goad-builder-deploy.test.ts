import { afterEach, describe, expect, it, vi } from "vitest"
import {
  claimGoadBuilderDeploy,
  parseGoadBuilderDeploy,
  readGoadBuilderDeploy,
  writeGoadBuilderDeploy,
} from "./goad-builder-deploy"

describe("parseGoadBuilderDeploy", () => {
  it("reads a lab, its extensions, and the target range", () => {
    expect(
      parseGoadBuilderDeploy(
        JSON.stringify({
          rangeId: "user-range",
          lab: "GOAD-Light",
          extensions: ["adcs", "ws01"],
          nonce: "abc",
        }),
      ),
    ).toEqual({
      rangeId: "user-range",
      lab: "GOAD-Light",
      extensions: ["adcs", "ws01"],
      nonce: "abc",
    })
  })

  it("keeps firewall rules the builder approved", () => {
    expect(
      parseGoadBuilderDeploy(
        JSON.stringify({
          rangeId: "user-range",
          lab: "GOAD-Light",
          extensions: [],
          nonce: "abc",
          networkRules: [
            {
              name: "dc to ws",
              vlan_src: 10,
              vlan_dst: 10,
              ip_last_octet_src: "10",
              ip_last_octet_dst: "20",
              protocol: "all",
              ports: "all",
              action: "ACCEPT",
            },
          ],
        }),
      )?.networkRules,
    ).toEqual([
      {
        name: "dc to ws",
        vlan_src: 10,
        vlan_dst: 10,
        ip_last_octet_src: "10",
        ip_last_octet_dst: "20",
        protocol: "all",
        ports: "all",
        action: "ACCEPT",
      },
    ])
  })

  it("records that the lab replaces the range configuration", () => {
    expect(
      parseGoadBuilderDeploy(
        JSON.stringify({
          rangeId: "user-range",
          lab: "GOAD",
          extensions: [],
          nonce: "abc",
          replacesConfig: true,
          networkRules: [],
        }),
      ),
    ).toMatchObject({ replacesConfig: true, networkRules: [] })
  })

  it("rejects a broken payload", () => {
    expect(parseGoadBuilderDeploy("nope")).toBeNull()
    expect(parseGoadBuilderDeploy(JSON.stringify({ rangeId: "a", lab: "b" }))).toBeNull()
    expect(
      parseGoadBuilderDeploy(
        JSON.stringify({ rangeId: "a", lab: "b", extensions: ["ok", "ok"], nonce: "n" }),
      ),
    ).toBeNull()
  })
})

describe("goad builder deploy handoff", () => {
  const memory = new Map<string, string>()

  afterEach(() => {
    memory.clear()
    vi.unstubAllGlobals()
  })

  it("is claimed once, then a refresh does not start it again", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value)
      },
      removeItem: (key: string) => {
        memory.delete(key)
      },
    })
    vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000001")

    const written = writeGoadBuilderDeploy({
      rangeId: "user-range",
      lab: "GOAD",
      extensions: ["mssql"],
    })
    expect(written?.nonce).toBe("00000000-0000-4000-8000-000000000001")
    expect(readGoadBuilderDeploy()?.lab).toBe("GOAD")
    expect(claimGoadBuilderDeploy(written!.nonce)).toBe(true)
    expect(readGoadBuilderDeploy()).toBeNull()
    expect(claimGoadBuilderDeploy(written!.nonce)).toBe(false)
  })
})
