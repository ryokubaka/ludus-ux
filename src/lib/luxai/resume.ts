/** Marks a turn that starts because a guest command finished, not because the operator typed. */
export const LUXAI_RESUME_MARKER = "[[luxai-resume]]"

export function isResumeQuestion(text: string): boolean {
  return text.trimStart().startsWith(LUXAI_RESUME_MARKER)
}

/** The id of a guest-command result that has not been followed by another turn. */
export function appliedProposalId(text: string): string {
  const match = text.match(/^(?:The operator applied proposal |Proposal )([0-9a-f-]{36})\b/i)
  return match?.[1] ?? ""
}

/** The model sees this. The page shows a short note instead of the instruction. */
export function resumeQuestion(proposalId: string): string {
  return `${LUXAI_RESUME_MARKER}
The operator applied proposal ${proposalId}. Its output is in the previous message.
The original request is still open.
A read-only command only checks. If the setting they asked for is not already in place, propose that change and wait for Apply. Do not stop after restating the output.
If the output shows the setting is already in place, say so and stop.
If the output is not enough to decide, or the command failed, propose the next read-only check and wait for Apply.
Do not describe how to use the setting.`
}
