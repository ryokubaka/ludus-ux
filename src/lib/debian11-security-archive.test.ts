import { spawnSync } from "node:child_process"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  debian11PatchBlocksDeploy,
  deployNeedsDebian11Archive,
  luxHostMissingOperation,
  parseDebian11ArchivePatch,
  rangeDeployRunsHostnameSetup,
  rangeDeployRunsWindowsTools,
} from "@/lib/debian11-security-archive"

const helper = path.join(process.cwd(), "scripts/lux-host/lux-host")

const playbook = `---
- name: earlier
  ansible.builtin.debug:
    msg: hi

## Linux ##
###########
  - name: Install dbus for systemd hostname changes
    ansible.builtin.apt:
      name: dbus
      state: present
  - name: Set the hostname
    ansible.builtin.hostname:
      name: lab
`

function bash(script: string, extraEnv: Record<string, string> = {}) {
  const prelude = `
    idbin=$(mktemp -d)
    printf '%s\\n' '#!/bin/sh' 'if [ "$1" = "-u" ]; then echo 0; exit 0; fi' 'echo 0' > "$idbin/id"
    chmod +x "$idbin/id"
    export PATH="$idbin:$PATH"
  `
  return spawnSync("bash", ["-c", prelude + script], {
    encoding: "utf8",
    env: {
      ...process.env,
      LUX_HOST_HELPER: helper.replaceAll("\\", "/"),
      ...extraEnv,
    },
  })
}

describe("parseDebian11ArchivePatch", () => {
  it("accepts an updated playbook and a skip", () => {
    expect(parseDebian11ArchivePatch("status=ok\nchanged=yes\n", "", 0)).toEqual({
      ok: true,
      changed: true,
      skipped: null,
    })
    expect(parseDebian11ArchivePatch("status=skipped\nreason=missing\n", "", 0)).toEqual({
      ok: true,
      changed: false,
      skipped: "missing",
    })
  })

  it("treats a full deploy and assign-ip as hostname setup", () => {
    expect(rangeDeployRunsHostnameSetup(undefined)).toBe(true)
    expect(rangeDeployRunsHostnameSetup({})).toBe(true)
    expect(rangeDeployRunsHostnameSetup({ tags: "assign-ip,network" })).toBe(true)
    expect(rangeDeployRunsHostnameSetup({ tags: "network" })).toBe(false)
    expect(rangeDeployRunsHostnameSetup({ tags: "nexus" })).toBe(false)
    expect(rangeDeployRunsWindowsTools(undefined)).toBe(true)
    expect(rangeDeployRunsWindowsTools({ tags: "additional-tools" })).toBe(true)
    expect(rangeDeployRunsWindowsTools({ tags: "network" })).toBe(false)
  })

  it("uses stderr when lux-host refuses the edit", () => {
    const parsed = parseDebian11ArchivePatch("", "lux-host: bad playbook path\n", 2)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toContain("bad playbook path")
  })

  it("treats Debian 13 configs as not needing the Bullseye archive", () => {
    expect(deployNeedsDebian11Archive(undefined)).toBe(false)
    expect(deployNeedsDebian11Archive("")).toBe(false)
    expect(deployNeedsDebian11Archive("debian-13-x64-server-template")).toBe(false)
    expect(deployNeedsDebian11Archive("vm_name: lab-router-debian13-x64")).toBe(false)
    expect(deployNeedsDebian11Archive("debian-11-x64-server-template")).toBe(true)
    expect(deployNeedsDebian11Archive("vm_name: lab-router-debian11-x64")).toBe(true)
    expect(deployNeedsDebian11Archive("bullseye-security")).toBe(true)
  })

  it("recognizes a helper that does not have the playbook operation", () => {
    expect(luxHostMissingOperation("lux-host: operation not allowed: patch-chocolatey-openssh")).toBe(true)
    expect(luxHostMissingOperation("waiting to retry")).toBe(false)
  })

  it("blocks a hostname deploy only when the config names Debian 11", () => {
    const failed = { ok: false as const, error: "waiting to retry" }
    expect(debian11PatchBlocksDeploy(failed, undefined, "debian-13-x64-server-template")).toBe(false)
    expect(debian11PatchBlocksDeploy(failed, undefined, null)).toBe(false)
    expect(debian11PatchBlocksDeploy(failed, { tags: "network" }, "debian-11-x64-server-template")).toBe(false)
    expect(debian11PatchBlocksDeploy(failed, undefined, "debian-11-x64-server-template")).toBe(true)
    expect(debian11PatchBlocksDeploy({ ok: true, changed: false, skipped: "task" }, undefined, "debian-11-x64-server-template")).toBe(false)
  })
})

describe("patch-adguard-host-dns", () => {
  it("replaces public AdGuard resolvers with the Ludus host and stays put on the second run", () => {
    const result = bash(
      `
      set -euo pipefail
      dir=$(mktemp -d)
      template="$dir/AdGuardHome.yaml.j2"
      cat > "$template" <<'EOF'
dns:
  port: 53
  upstream_dns:
  - https://1.1.1.1/dns-query
  upstream_dns_file: ""
  bootstrap_dns:
  - 1.1.1.1
  - 9.9.9.10
  - 149.112.112.10
  - 2620:fe::10
  - 2620:fe::fe:10
  all_servers: false
EOF
      export LUX_ADGUARD_TEMPLATE="$template"
      bash "$LUX_HOST_HELPER" patch-adguard-host-dns
      echo "---FILE---"
      cat "$template"
      echo "---AGAIN---"
      bash "$LUX_HOST_HELPER" patch-adguard-host-dns
      `,
    )
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain("status=ok\nchanged=yes")
    expect(result.stdout).toContain("status=ok\nchanged=no")
    const file = result.stdout.split("---FILE---")[1]?.split("---AGAIN---")[0] ?? ""
    expect(file).not.toMatch(/1\.1\.1\.1|9\.9\.9\.10|2620:fe/)
    expect(file).toContain("upstream_dns:\n    - 192.0.2.254\n")
    expect(file).toContain("bootstrap_dns:\n    - 192.0.2.254\n")
    expect(file).toContain("upstream_dns_file:")
    expect(file).toContain("all_servers: false")
  })

  it("rejects arguments", () => {
    const result = bash('bash "$LUX_HOST_HELPER" patch-adguard-host-dns extra')
    expect(result.status).toBe(2)
    expect(result.stderr).toMatch(/lux-host:/)
  })
})

describe("patch-chocolatey-openssh", () => {
  it("inserts an install and a one-time reboot ahead of the Chocolatey bootstrap", () => {
    const result = bash(
      `
      set -euo pipefail
      dir=$(mktemp -d)
      play="$dir/add-additional-windows-tools.yml"
      cat > "$play" <<'EOF'
---
  - name: Bootstrap chocolatey by hand
    win_chocolatey:
      name: chocolatey
      state: present
  - name: Install 7zip
    win_chocolatey:
      name: 7zip
EOF
      export LUX_CHOCOLATEY_PLAYBOOK="$play"
      bash "$LUX_HOST_HELPER" patch-chocolatey-openssh
      echo "---FILE---"
      cat "$play"
      echo "---AGAIN---"
      bash "$LUX_HOST_HELPER" patch-chocolatey-openssh
      `,
    )
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain("status=ok\nchanged=yes")
    expect(result.stdout).toContain("status=ok\nchanged=no")
    const file = result.stdout.split("---FILE---")[1]?.split("---AGAIN---")[0] ?? ""
    const begin = file.indexOf("# BEGIN LUX-CHOCOLATEY-OPENSSH")
    const bootstrap = file.indexOf("- name: Bootstrap chocolatey by hand")
    const zip = file.indexOf("- name: Install 7zip")
    expect(begin).toBeGreaterThan(-1)
    expect(begin).toBeLessThan(bootstrap)
    expect(zip).toBeGreaterThan(bootstrap)
    expect(file).toContain("win_reboot:")
    expect(file).toContain("exit 10")
    expect(file.match(/BEGIN LUX-CHOCOLATEY-OPENSSH/g)).toHaveLength(1)
  })
})

describe("patch-debian11-apt", () => {
  it("rejects arguments", () => {
    const result = bash('bash "$LUX_HOST_HELPER" patch-debian11-apt extra')
    expect(result.status).toBe(2)
    expect(result.stderr).toMatch(/lux-host:/)
  })

  it("inserts one raw task ahead of dbus and leaves it unchanged on the second run", () => {
    const result = bash(
      `
      set -euo pipefail
      dir=$(mktemp -d)
      play="$dir/configure-ip-and-hostname-linux.yml"
      cat > "$play" <<'EOF'
${playbook}
EOF
      export LUX_DEBIAN11_APT_PLAYBOOK="$play"
      bash "$LUX_HOST_HELPER" patch-debian11-apt
      echo "---FILE---"
      cat "$play"
      echo "---AGAIN---"
      bash "$LUX_HOST_HELPER" patch-debian11-apt
      `,
    )
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain("status=ok\nchanged=yes")
    expect(result.stdout).toContain("status=ok\nchanged=no")
    const file = result.stdout.split("---FILE---")[1]?.split("---AGAIN---")[0] ?? ""
    const begin = file.indexOf("# BEGIN LUX-DEBIAN11-SECURITY-ARCHIVE")
    const dbus = file.indexOf("- name: Install dbus for systemd hostname changes")
    const end = file.indexOf("# END LUX-DEBIAN11-SECURITY-ARCHIVE")
    const hostname = file.indexOf("- name: Set the hostname")
    expect(begin).toBeGreaterThan(-1)
    expect(begin).toBeLessThan(dbus)
    expect(end).toBeGreaterThan(begin)
    expect(end).toBeLessThan(dbus)
    expect(hostname).toBeGreaterThan(dbus)
    expect(file.match(/BEGIN LUX-DEBIAN11-SECURITY-ARCHIVE/g)).toHaveLength(1)
    expect(file).toContain("https://archive.debian.org/debian-security")
    expect(file).toContain("changed_when: false")
  })

  it("rewrites bullseye-security to the HTTPS archive and installs ca-certificates when it is missing", () => {
    const result = bash(
      `
      set -euo pipefail
      dir=$(mktemp -d)
      play="$dir/configure-ip-and-hostname-linux.yml"
      cat > "$play" <<'EOF'
${playbook}
EOF
      export LUX_DEBIAN11_APT_PLAYBOOK="$play"
      bash "$LUX_HOST_HELPER" patch-debian11-apt >/dev/null
      script="$dir/guest.sh"
      awk '
        $0 ~ /raw: \\|/ { grab=1; next }
        grab && $0 ~ /changed_when:/ { exit }
        grab { sub(/^      /, ""); print }
      ' "$play" > "$script"
      root="$dir/root"
      mkdir -p "$root/etc/apt/sources.list.d" "$root/etc/apt/apt.conf.d"
      printf '%s\\n' 'ID=debian' 'VERSION_ID="11"' > "$root/etc/os-release"
      printf '%s\\n' 'deb http://deb.debian.org/debian bullseye main' 'deb http://security.debian.org/debian-security bullseye-security main' > "$root/etc/apt/sources.list"
      printf '%s\\n' 'Types: deb' 'URIs: https://security.debian.org/debian-security' 'Suites: bullseye/updates' 'Components: main' > "$root/etc/apt/sources.list.d/security.sources"
      bin="$dir/bin"
      mkdir -p "$bin"
      printf '%s\\n' '#!/bin/sh' 'exit 1' > "$bin/dpkg-query"
      printf '%s\\n' '#!/bin/sh' 'printf "%s\\n" "$*" >> "$LUX_APT_LOG"' 'exit 0' > "$bin/apt-get"
      chmod +x "$bin/dpkg-query" "$bin/apt-get"
      export LUX_APT_ROOT="$root" LUX_APT_LOG="$dir/apt.log" PATH="$bin:$PATH"
      sh "$script"
      echo "---SOURCES---"
      cat "$root/etc/apt/sources.list"
      echo "---DEB822---"
      cat "$root/etc/apt/sources.list.d/security.sources"
      echo "---CONF---"
      cat "$root/etc/apt/apt.conf.d/99lux-debian11-archive"
      echo "---APTLOG---"
      cat "$dir/apt.log"
      `,
    )
    expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(0)
    const sources = result.stdout.split("---SOURCES---")[1]?.split("---DEB822---")[0] ?? ""
    const deb822 = result.stdout.split("---DEB822---")[1]?.split("---CONF---")[0] ?? ""
    const conf = result.stdout.split("---CONF---")[1]?.split("---APTLOG---")[0] ?? ""
    const aptLog = result.stdout.split("---APTLOG---")[1] ?? ""
    expect(sources).toContain("deb http://deb.debian.org/debian bullseye main")
    expect(sources).toContain("deb https://archive.debian.org/debian-security bullseye-security main")
    expect(sources).not.toContain("security.debian.org")
    expect(deb822).toContain("URIs: https://archive.debian.org/debian-security")
    expect(deb822).toContain("Suites: bullseye-security")
    expect(deb822).not.toContain("security.debian.org")
    expect(deb822).not.toContain("bullseye/updates")
    expect(conf).toContain('Acquire::Check-Valid-Until "false";')
    expect(aptLog).toContain("ca-certificates")
  })
})
