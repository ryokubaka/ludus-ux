import { NextResponse } from "next/server"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

export async function GET() {
  try {
    const pkgPath = join(process.cwd(), "package.json")
    const pkg = JSON.parse(await readFile(pkgPath, "utf-8")) as {
      name?: string
      version?: string
      description?: string
      license?: string
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }

    const deps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    }

    return NextResponse.json({
      name: pkg.name ?? "ludus-ux",
      version: pkg.version ?? "0.0.0",
      description: pkg.description ?? "",
      license: pkg.license ?? "Apache-2.0",
      dependencies: Object.entries(deps)
        .map(([name, version]) => ({ name, version: String(version) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    })
  } catch {
    return NextResponse.json({ error: "Could not read package info" }, { status: 500 })
  }
}
