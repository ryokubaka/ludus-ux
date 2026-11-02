/**
 * Sidebar range changes on a GOAD instance page.
 * Opening the page aligns the sidebar to that lab's range. A later choice
 * leaves: a range with a GOAD lab opens that instance, any other range opens
 * the Dashboard.
 */

export interface GoadRangeFollow {
  alignedInstanceId: string | null
  alignedRangeId: string | null
}

export interface GoadRangeFollowInput {
  instanceId: string
  instanceRangeId: string | null
  selectedRangeId: string | null
  /** Accessible-range list has finished its first load. */
  rangesReady: boolean
  /** This lab's range is still in that list. A deleted range is not. */
  instanceRangeListed: boolean
}

export interface GoadRangeFollowStep {
  state: GoadRangeFollow
  /** Write this id into the sidebar. Null leaves the current choice. */
  selectRangeId: string | null
  /** User picked a different range. Look up where to go. */
  leaveForRangeId: string | null
}

export function stepGoadRangeFollow(
  state: GoadRangeFollow,
  input: GoadRangeFollowInput,
): GoadRangeFollowStep {
  const instanceId = input.instanceId.trim()
  const instanceRangeId = input.instanceRangeId?.trim() || null
  const selectedRangeId = input.selectedRangeId?.trim() || null
  const stay = { state, selectRangeId: null, leaveForRangeId: null }

  if (!instanceId || !instanceRangeId || !input.rangesReady) return stay

  const aligned =
    state.alignedInstanceId === instanceId && state.alignedRangeId === instanceRangeId

  if (!aligned) {
    // A deleted lab range is not in the list. Do not invent a selection, and do
    // not treat the sidebar's current range as a click that should leave.
    if (!input.instanceRangeListed) return stay
    return {
      state: { alignedInstanceId: instanceId, alignedRangeId: instanceRangeId },
      selectRangeId: selectedRangeId === instanceRangeId ? null : instanceRangeId,
      leaveForRangeId: null,
    }
  }

  if (!selectedRangeId || selectedRangeId === instanceRangeId) return stay
  return { state, selectRangeId: null, leaveForRangeId: selectedRangeId }
}

/** Dashboard when the range has no GOAD lab; that lab's page when it does. */
export function hrefForGoadRangeSwitch(linkedInstanceId: string | null | undefined): string {
  const id = linkedInstanceId?.trim()
  if (!id) return "/"
  return `/goad/${encodeURIComponent(id)}`
}

/** Instance id for a range from a lab list the page already loaded. */
export function linkedInstanceIdForRange(
  instances: readonly { instanceId?: string | null; ludusRangeId?: string | null }[],
  rangeId: string,
): string | null {
  const want = rangeId.trim()
  if (!want) return null
  for (const inst of instances) {
    const id = inst.instanceId?.trim()
    if (id && (inst.ludusRangeId ?? "").trim() === want) return id
  }
  return null
}
