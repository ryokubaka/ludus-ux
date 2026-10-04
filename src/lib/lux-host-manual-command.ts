const LINUX_USER = /^[a-z_][a-z0-9_-]{0,31}$/
const PASTE_MARK = "LUX_HOST_PASTE"
const FILE_MARK = "LUX_HOST_FILE"

/**
 * One paste for a root shell. The block contains the helper and the sudoers
 * rule, so nothing else has to be copied onto the Ludus host.
 */
export function luxHostManualInstallCommand(user: string, helper: string): string {
  const name = user.trim()
  if (name === "root" || !LINUX_USER.test(name)) {
    throw new Error("SSH user must be a plain Linux username other than root")
  }
  const body = helper.replace(/\r\n/g, "\n").replace(/\n$/, "")
  if (!body.startsWith("#!")) {
    throw new Error("lux-host script is missing")
  }
  for (const line of body.split("\n")) {
    if (line === PASTE_MARK || line === FILE_MARK || line === "EOF") {
      throw new Error("lux-host script collides with the install command")
    }
  }
  return [
    `bash << '${PASTE_MARK}'`,
    "set -euo pipefail",
    "mkdir -p /usr/local/sbin /etc/sudoers.d",
    `cat > /usr/local/sbin/lux-host << '${FILE_MARK}'`,
    body,
    FILE_MARK,
    "chown root:root /usr/local/sbin/lux-host",
    "chmod 755 /usr/local/sbin/lux-host",
    "tmp=$(mktemp)",
    "cat > \"$tmp\" << 'EOF'",
    "Cmnd_Alias LUX_HOST = /usr/local/sbin/lux-host",
    `${name} ALL=(root) NOPASSWD: LUX_HOST`,
    "EOF",
    "visudo -cf \"$tmp\"",
    "install -o root -g root -m 440 \"$tmp\" /etc/sudoers.d/lux-host",
    "rm -f \"$tmp\"",
    PASTE_MARK,
  ].join("\n")
}
