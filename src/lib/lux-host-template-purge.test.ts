import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { buildLudusTemplateDeleteCmd } from "./template-packer-paths"

const helper = path.join(process.cwd(), "scripts/lux-host/lux-host")

function shellArgs(args: readonly string[]): string {
  return args.map((arg) => JSON.stringify(arg)).join(" ")
}

const debianPurge = shellArgs(buildLudusTemplateDeleteCmd("/opt/ludus", "debian-13-x64-server-template"))
const onionPurge = shellArgs(buildLudusTemplateDeleteCmd("/opt/ludus", "securityonion-2.4-x64-template"))

function runPurge(body: string, pathPrefix = ""): { status: number; stdout: string; stderr: string } {
  const script = `
mount -t tmpfs tmpfs /opt || exit 90
helper=${JSON.stringify(helper)}
write_hcl() {
  mkdir -p "$(dirname "$1")"
  cat > "$1" <<EOF
variable "vm_name" {
  default = "$2"
}
EOF
}
${body}
`
  const result = spawnSync("unshare", ["--user", "--map-root-user", "--mount", "bash", "-c", script], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${pathPrefix}${pathPrefix ? ":" : ""}/usr/bin:/bin`,
    },
  })
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  }
}

describe("lux-host template-purge", () => {
  it("removes install copies by alias and list-name vm_name and leaves source checkouts", () => {
    const out = runPurge(`
write_hcl /opt/ludus/packer/debian13/debian.pkr.hcl debian-13-x64-server-template
write_hcl /opt/ludus/packer/templates/debian13/debian.pkr.hcl debian-13-x64-server-template
write_hcl /opt/ludus/users/alice/packer/debian13/debian.pkr.hcl debian-13-x64-server-template
write_hcl /opt/ludus/sources/abc/templates/debian13/debian.pkr.hcl debian-13-x64-server-template
write_hcl /opt/ludus/packer/other/other.pkr.hcl securityonion-2.4
write_hcl /opt/ludus/sources/abc/templates/so-src/so.pkr.hcl securityonion-2.4
write_hcl /opt/ludus/packer/templates/keep-list/keep.pkr.hcl securityonion-2.4-x64-template
write_hcl /opt/ludus/users/bob/packer/keep-user/keep.pkr.hcl securityonion-2.4-x64-template
mkdir -p /opt/ludus/packer/securityonion-2.4 /opt/ludus/sources/abc/templates/securityonion-2.4 /opt/ludus/users/alice/packer/securityonion-2.4
bash "$helper" ${debianPurge}
status=$?
if [ "$status" -ne 0 ]; then
  echo "debian purge status $status" >&2
  exit "$status"
fi
bash "$helper" ${onionPurge}
status=$?
if [ "$status" -ne 0 ]; then
  echo "onion purge status $status" >&2
  exit "$status"
fi
gone() { if [ -d "$1" ]; then echo "still $1" >&2; exit 1; fi; }
kept() { if [ ! -d "$1" ]; then echo "missing $1" >&2; exit 1; fi; }
gone /opt/ludus/packer/debian13
gone /opt/ludus/packer/templates/debian13
gone /opt/ludus/users/alice/packer/debian13
kept /opt/ludus/sources/abc/templates/debian13
kept /opt/ludus/packer/other
kept /opt/ludus/sources/abc/templates/so-src
gone /opt/ludus/packer/templates/keep-list
gone /opt/ludus/users/bob/packer/keep-user
gone /opt/ludus/packer/securityonion-2.4
gone /opt/ludus/sources/abc/templates/securityonion-2.4
gone /opt/ludus/users/alice/packer/securityonion-2.4
`)
    expect(out.status, out.stderr).toBe(0)
    expect(out.stdout).toMatch(/ok/)
    expect(out.stderr).not.toMatch(/still present/)
  })

  it("fails when an install directory whose vm_name is the list name is still present", () => {
    const bin = mkdtempSync(path.join(tmpdir(), "lux-purge-rm-"))
    writeFileSync(path.join(bin, "rm"), "#!/bin/sh\nexit 0\n", { mode: 0o755 })
    const out = runPurge(
      `
write_hcl /opt/ludus/packer/debian13/debian.pkr.hcl debian-13-x64-server-template
write_hcl /opt/ludus/sources/abc/templates/debian13/debian.pkr.hcl debian-13-x64-server-template
bash "$helper" ${debianPurge}
status=$?
if [ ! -d /opt/ludus/packer/debian13 ]; then
  echo "install removed" >&2
  exit 93
fi
if [ ! -d /opt/ludus/sources/abc/templates/debian13 ]; then
  echo "source removed" >&2
  exit 94
fi
exit $status
`,
      bin,
    )
    expect(out.status, out.stderr).toBe(1)
    expect(out.stderr).toMatch(/still present: packer vm_name/)
    expect(out.stderr).not.toMatch(/\/opt\/ludus\/sources/)

    const userTree = runPurge(
      `
write_hcl /opt/ludus/users/alice/packer/debian13/debian.pkr.hcl debian-13-x64-server-template
write_hcl /opt/ludus/sources/abc/templates/debian13/debian.pkr.hcl debian-13-x64-server-template
bash "$helper" ${debianPurge}
status=$?
if [ ! -d /opt/ludus/users/alice/packer/debian13 ]; then
  echo "install removed" >&2
  exit 93
fi
if [ ! -d /opt/ludus/sources/abc/templates/debian13 ]; then
  echo "source removed" >&2
  exit 94
fi
exit $status
`,
      bin,
    )
    expect(userTree.status, userTree.stderr).toBe(1)
    expect(userTree.stderr).toMatch(/still present: packer vm_name/)
    expect(userTree.stderr).not.toMatch(/\/opt\/ludus\/sources/)
  })
})
