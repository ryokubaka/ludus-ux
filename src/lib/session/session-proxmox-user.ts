import { ludusRequest } from "@/lib/ludus/ludus-client"
import type { ResolvedSession } from "@/lib/session/session"
import type { UserObject } from "@/lib/core/types"

/** Shown when a console ticket needs a PAM password and the session has none. */
export const CONSOLE_PAM_PASSWORD_REQUIRED =
  "This console needs your Ludus login password so LUX can request a Proxmox ticket for your user. Host SSH keys are for server commands, not console tickets. Log out and log in with your SSH/PAM password."

/**
 * Proxmox PAM name for the account that logged into LUX.
 * Uses that account's API key, not an impersonation key: the stored password belongs to the admin.
 */
export async function resolveSessionProxmoxUser(
  session: Pick<ResolvedSession, "apiKey" | "username">,
): Promise<string> {
  const result = await ludusRequest<UserObject | UserObject[]>("/user", { apiKey: session.apiKey })
  if (result.error || result.status !== 200) {
    throw new Error(`Failed to resolve logged-in user's Proxmox username from Ludus API (HTTP ${result.status}): ${result.error || "unknown error"}`)
  }

  const raw = Array.isArray(result.data) ? result.data[0] : result.data
  const user = (raw?.proxmoxUsername || raw?.userID || session.username).trim().toLowerCase()
  if (!user) throw new Error("Failed to resolve logged-in user's Proxmox username from Ludus API")
  return user
}
