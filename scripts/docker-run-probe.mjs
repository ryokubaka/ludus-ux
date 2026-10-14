/**
 * Runs the same host probe as Settings → About (dev helper).
 * Usage: DOCKER_SOCKET_PATH='//./pipe/docker_engine' node scripts/docker-run-probe.mjs
 */
import { discoverLuxRepoPathContext, runHostScriptViaDocker } from "../src/lib/lux-upgrade-docker.ts"
import { buildHostProbeCmd, parseHostProbe } from "../src/lib/lux-upgrade-host.ts"

const ctx = await discoverLuxRepoPathContext()
const out = await runHostScriptViaDocker(buildHostProbeCmd(ctx))
const cap = parseHostProbe(out)
console.log(out)
console.log(JSON.stringify(cap, null, 2))
process.exit(cap.canSwitch ? 0 : 1)
