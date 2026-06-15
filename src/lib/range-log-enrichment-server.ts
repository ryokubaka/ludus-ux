import "server-only"

import type { ResolvedSession } from "@/lib/session-edge"
import type { RangeLogMarkerEnrichment } from "@/lib/range-log-marker-types"
import { listLuxDeployTagRuns, listLuxTestingEvents } from "@/lib/range-log-markers-store"

export function effectiveUsernameForMarkers(session: ResolvedSession): string {
  if (session.impersonationApiKey) {
    return (
      session.impersonationSshLogin ||
      session.impersonationUserId ||
      session.username
    ).trim()
  }
  return session.username
}

export function fetchRangeLogEnrichmentForUser(
  rangeId: string,
  effectiveUsername: string,
): RangeLogMarkerEnrichment {
  const rid = rangeId.trim()
  const user = effectiveUsername.trim()
  return {
    testingEvents: listLuxTestingEvents(rid, user, 120),
    deployTagRuns: listLuxDeployTagRuns(rid, user, 200),
  }
}

export function fetchRangeLogEnrichment(
  session: ResolvedSession,
  rangeId: string,
): RangeLogMarkerEnrichment {
  return fetchRangeLogEnrichmentForUser(rangeId, effectiveUsernameForMarkers(session))
}
