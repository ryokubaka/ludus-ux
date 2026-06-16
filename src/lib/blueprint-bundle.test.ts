import { describe, expect, it } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as tar from "tar"
import { buildBlueprintTarGz } from "./blueprint-bundle"

async function extractTarGz(archive: Buffer): Promise<Map<string, string>> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "lux-bp-test-"))
  const archivePath = path.join(tmpDir, "bundle.tar.gz")
  try {
    await fs.writeFile(archivePath, archive)
    await tar.x({ gzip: true, cwd: tmpDir, file: archivePath, sync: true })
    const entries = new Map<string, string>()

    async function walk(rel = ""): Promise<void> {
      const dir = path.join(tmpDir, rel)
      const names = await fs.readdir(dir)
      for (const name of names) {
        if (name === "bundle.tar.gz") continue
        const entryRel = rel ? `${rel}/${name}` : name
        const full = path.join(tmpDir, entryRel)
        const stat = await fs.stat(full)
        if (stat.isDirectory()) {
          await walk(entryRel)
        } else {
          entries.set(entryRel.replace(/\\/g, "/"), await fs.readFile(full, "utf8"))
        }
      }
    }

    await walk()
    return entries
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

describe("buildBlueprintTarGz", () => {
  it("packs files at archive root and round-trips contents", async () => {
    const archive = await buildBlueprintTarGz([
      { relativePath: "blueprint.yml", content: Buffer.from("id: test\n") },
      { relativePath: "range-config.yml", content: Buffer.from("ludus:\n  - vm_name: x\n") },
      { relativePath: "testing/check.sh", content: Buffer.from("#!/bin/bash\n") },
    ])

    expect(archive.length).toBeGreaterThan(0)
    expect(archive[0]).toBe(0x1f)
    expect(archive[1]).toBe(0x8b)

    const extracted = await extractTarGz(archive)
    expect(extracted.get("blueprint.yml")).toBe("id: test\n")
    expect(extracted.get("range-config.yml")).toBe("ludus:\n  - vm_name: x\n")
    expect(extracted.get("testing/check.sh")).toBe("#!/bin/bash\n")
  })

  it("rejects empty bundle", async () => {
    await expect(buildBlueprintTarGz([])).rejects.toThrow(/no files/i)
  })
})
