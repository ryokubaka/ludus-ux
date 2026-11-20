/** Ansible prints `failed=0` on a clean recap. That word is not a failed task. */
export function guestOutputFailed(output: string): boolean {
  if (/\bfailed=[1-9]\d*\b/.test(output) || /\bunreachable=[1-9]\d*\b/.test(output)) return true
  return /\b(fatal:|FAILED!|exited [1-9]|non-zero|rc=[1-9])/i.test(output)
}
