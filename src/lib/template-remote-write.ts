import { randomUUID } from "crypto"
import { sshExec } from "@/lib/goad-ssh"
import { SSH_B64_CHUNK_CHARS } from "@/lib/template-packer-paths"

/** Write binary content to the Ludus host without exceeding SSH ARG_MAX. */
export async function writeRemoteFileViaSsh(destPath: string, content: Buffer): Promise<void> {
  const b64 = content.toString("base64")
  const id = randomUUID()

  const init = await sshExec(["b64-init", id])
  if (init.code !== 0) {
    throw new Error(`Failed to init temp file for ${destPath}: ${init.stderr || init.stdout}`)
  }

  for (let i = 0; i < b64.length; i += SSH_B64_CHUNK_CHARS) {
    const chunk = b64.slice(i, i + SSH_B64_CHUNK_CHARS)
    const append = await sshExec(["b64-append", id, chunk])
    if (append.code !== 0) {
      await sshExec(["b64-abort", id]).catch(() => {})
      throw new Error(
        `Failed to write ${destPath} (chunk ${i / SSH_B64_CHUNK_CHARS + 1}): ${append.stderr || append.stdout}`,
      )
    }
  }

  const decode = await sshExec(["b64-finish", id, destPath])
  if (decode.code !== 0) {
    throw new Error(`Failed to decode ${destPath}: ${decode.stderr || decode.stdout}`)
  }
}
