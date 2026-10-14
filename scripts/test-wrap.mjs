import { runHostScriptViaDocker } from "../src/lib/lux-upgrade-docker.ts"
import { wrapEncodedHostShellScript } from "../src/lib/lux-upgrade-host.ts"

const out = await runHostScriptViaDocker(
  wrapEncodedHostShellScript([
    "REPO=/run/desktop/mnt/host/e/gitlab/ludus-ux",
    "printf 'repo=%s\\n' \"$REPO\"",
  ]),
)
console.log(out)
