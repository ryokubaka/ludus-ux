import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import yaml from "js-yaml"
import { describe, expect, it } from "vitest"
import { LUDUS_WRAPPER_SH } from "./goad-ssh"

describe("ludus range wrapper network merge", () => {
  it("keeps snapshot rule order and evaluates rules that exist only on the file after them", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lux-wrapper-"))
    const config = path.join(dir, "config.yml")
    writeFileSync(
      config,
      [
        "ludus: []",
        "network:",
        "  inter_vlan_default: ACCEPT",
        "  rules:",
        "    - name: ext-c",
        "      ports: \"1\"",
        "    - name: existing-b",
        "      ports: \"9\"",
        "    - name: existing-a",
        "      ports: \"9\"",
        "",
      ].join("\n"),
    )
    writeFileSync(
      path.join(dir, ".lux-network-snapshot.json"),
      JSON.stringify({
        inter_vlan_default: "DROP",
        rules: [
          { name: "existing-b", ports: "2" },
          { name: "existing-a", ports: "3" },
        ],
      }),
    )
    const ludus = path.join(dir, "ludus")
    writeFileSync(ludus, "#!/bin/sh\nexit 0\n", { mode: 0o755 })
    const wrapper = path.join(dir, "wrapper.sh")
    writeFileSync(wrapper, LUDUS_WRAPPER_SH.replaceAll("REAL_LUDUS_PATH", ludus), { mode: 0o755 })
    const result = spawnSync(wrapper, ["range", "config", "set", "-f", config], {
      encoding: "utf8",
      env: { ...process.env, LUDUS_RANGE_ID: "range-1", PATH: process.env.PATH },
    })
    expect(result.status).toBe(0)
    const doc = yaml.load(readFileSync(config, "utf8")) as {
      network: { inter_vlan_default: string; rules: { name: string; ports: string }[] }
    }
    expect(doc.network.inter_vlan_default).toBe("DROP")
    expect(doc.network.rules.map((rule) => rule.name)).toEqual(["ext-c", "existing-b", "existing-a"])
    expect(doc.network.rules.find((rule) => rule.name === "existing-b")?.ports).toBe("2")
  })
})
