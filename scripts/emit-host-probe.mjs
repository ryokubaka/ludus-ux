/**
 * Prints the host probe shell script (for manual nsenter debugging). Dev-only.
 * Usage: node scripts/emit-host-probe.mjs | docker run ...
 */
import { buildHostProbeCmd } from "../src/lib/lux/lux-upgrade-host.ts"
import { discoverLuxRepoPathContext } from "../src/lib/lux/lux-upgrade-docker.ts"

const ctx = await discoverLuxRepoPathContext()
process.stdout.write(buildHostProbeCmd(ctx))
