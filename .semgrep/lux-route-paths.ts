// Test cases for lux-request-value-in-fs-path (run: semgrep --test .semgrep/).
// The rule only applies to src/app/api/**/route.ts; --test ignores `paths`.
import fs from "node:fs"
import path from "node:path"

declare function assertSafeInstanceId(id: string): string
declare const DIR: string
type Ctx = { params: Promise<{ instanceId: string }> }
type Req = { nextUrl: URL; json(): Promise<{ name: string }> }

export async function GET(request: Req, ctx: Ctx) {
  const { instanceId } = await ctx.params
  // ruleid: lux-request-value-in-fs-path
  fs.readFileSync(path.join(DIR, `${instanceId}.json`))

  const safe = assertSafeInstanceId(instanceId)
  // ok: lux-request-value-in-fs-path
  fs.readFileSync(path.join(DIR, `${safe}.json`))

  const file = request.nextUrl.searchParams.get("file") ?? ""
  // ruleid: lux-request-value-in-fs-path
  fs.unlinkSync(file)

  // ok: lux-request-value-in-fs-path
  fs.unlinkSync(path.join(DIR, path.basename(file)))

  const body = await request.json()
  // ruleid: lux-request-value-in-fs-path
  fs.writeFileSync(path.join(DIR, body.name), "x")
}
