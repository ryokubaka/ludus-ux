import { Agent } from "undici"

/**
 * Undici Agent for outbound HTTPS to Ludus / PocketBase on the same host.
 * Certificate verification is disabled (typical Proxmox/Ludus self-signed or cluster CA).
 *
 * `server/ws-server.ts` sets NODE_TLS_REJECT_UNAUTHORIZED=0 globally for Proxmox browser APIs;
 * this agent applies the same policy explicitly for fetch() without relying on env for Ludus traffic.
 */

let ludusAgent: Agent | null = null

export function getLudusUndiciDispatcher(): Agent {
  if (!ludusAgent) {
    ludusAgent = new Agent({ connect: { rejectUnauthorized: false } })
  }
  return ludusAgent
}
