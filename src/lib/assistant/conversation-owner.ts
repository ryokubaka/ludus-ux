/**
 * Conversation ownership for the in-app assistant.
 * Always scoped to the effective Ludus principal — never cross-user.
 * While impersonating, that principal is the target (admin sees their sessions only).
 */

export type AssistantOwnerSession = {
  username: string
  impersonationUserId?: string | null
  impersonationLudusUserId?: string | null
}

export function assistantConversationOwner(session: AssistantOwnerSession): string {
  const impersonated = (
    session.impersonationLudusUserId ||
    session.impersonationUserId ||
    ""
  ).trim()
  if (impersonated) return impersonated
  return (session.username || "").trim()
}
