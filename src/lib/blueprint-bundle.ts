import fs from "fs/promises"
import os from "os"
import path from "path"
import * as tar from "tar"

export interface BlueprintBundleFile {
  relativePath: string
  content: Buffer | Uint8Array
}

/** Pack blueprint files into a gzip-compressed tar archive for Ludus /blueprints/import. */
export async function buildBlueprintTarGz(files: BlueprintBundleFile[]): Promise<Buffer> {
  if (files.length === 0) {
    throw new Error("Blueprint bundle has no files")
  }

  const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), "lux-bp-"))
  const archivePath = path.join(os.tmpdir(), `lux-bp-${process.pid}-${Date.now()}.tar.gz`)
  try {
    const relPaths: string[] = []
    for (const f of files) {
      const rel = f.relativePath.replace(/^\/+/, "")
      relPaths.push(rel)
      const dest = path.join(stagingDir, rel)
      await fs.mkdir(path.dirname(dest), { recursive: true })
      await fs.writeFile(dest, Buffer.from(f.content))
    }

    await tar.c(
      { gzip: true, cwd: stagingDir, portable: true, file: archivePath, sync: true },
      relPaths,
    )
    return await fs.readFile(archivePath)
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {})
    await fs.unlink(archivePath).catch(() => {})
  }
}
