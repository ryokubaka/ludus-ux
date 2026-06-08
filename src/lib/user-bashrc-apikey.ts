import { sshExec } from "@/lib/goad-ssh"

const POSIX_USER = /^[a-zA-Z0-9_.-]+$/

export function isValidLudusSshUsername(username: string): boolean {
  return POSIX_USER.test(username)
}

/** Read LUDUS_API_KEY from a Ludus user's ~/.bashrc via root SSH. */
export async function readUserApiKeyFromBashrc(
  username: string,
): Promise<{ apiKey: string | null; message?: string }> {
  if (!isValidLudusSshUsername(username)) {
    return { apiKey: null, message: "Valid username required" }
  }

  const cmd = [
    `grep -E '^[[:space:]]*(export[[:space:]]+)?LUDUS_API_KEY=' /home/${username}/.bashrc 2>/dev/null`,
    "tail -1",
    `grep -oP "LUDUS_API_KEY=['\"]?\\K[^'\"\\s]+"`,
  ].join(" | ")

  try {
    const { stdout, code } = await sshExec(cmd)
    const apiKey = stdout.trim()
    if (code !== 0 || !apiKey) {
      return { apiKey: null, message: "Key not found in ~/.bashrc" }
    }
    return { apiKey }
  } catch {
    return { apiKey: null, message: "SSH error reading ~/.bashrc" }
  }
}
