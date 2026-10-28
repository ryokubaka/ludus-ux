/**
 * Host features some shell-level tests need. A test skips when its feature is
 * missing, unless LUX_TEST_REQUIRE_CAPS lists it: CI sets that so a test that
 * should run there fails loudly instead of skipping.
 */
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

export type HostCapability = "userns" | "pyyaml" | "visudo" | "nonroot"

function probe(capability: HostCapability): boolean {
  switch (capability) {
    case "userns": {
      if (process.platform !== "linux") return false
      const dir = mkdtempSync(path.join(tmpdir(), "lux-userns-"))
      try {
        const result = spawnSync(
          "unshare",
          ["--user", "--map-root-user", "--mount", "sh", "-c", `mount -t tmpfs tmpfs '${dir}'`],
          { encoding: "utf8" },
        )
        return result.status === 0
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }
    case "pyyaml":
      return spawnSync("python3", ["-c", "import yaml"], { encoding: "utf8" }).status === 0
    case "visudo":
      return spawnSync("sh", ["-c", "command -v visudo || test -x /usr/sbin/visudo"], { encoding: "utf8" }).status === 0
    case "nonroot":
      return typeof process.getuid !== "function" || process.getuid() !== 0
    default: {
      const unreachable: never = capability
      return unreachable
    }
  }
}

const required = new Set(
  (process.env.LUX_TEST_REQUIRE_CAPS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
)

const cache = new Map<HostCapability, boolean>()

/** True when the test must be skipped. Throws when CI requires the capability. */
export function lacks(capability: HostCapability): boolean {
  if (!cache.has(capability)) cache.set(capability, probe(capability))
  const available = cache.get(capability)!
  if (!available && required.has(capability)) {
    throw new Error(`LUX_TEST_REQUIRE_CAPS includes ${capability}, but this host does not provide it`)
  }
  return !available
}
