import { ludusRequest } from "@/lib/ludus/ludus-client"
import { ludusCallerFromGetUser } from "@/lib/ludus/ludus-user-from-profile"
import { isCertificateError, ludusTlsCertificateHint } from "@/lib/settings/tls-insecure-env"

export type LudusUserCheckResult =
  | { ok: true; isAdmin: boolean }
  | { ok: false; kind: "unauthorized" }
  | { ok: false; kind: "profile_mismatch" }
  | { ok: false; kind: "unreachable"; message: string }

/** Validate a Ludus API key and resolve the caller profile. */
export async function checkLudusUser(
  apiKey: string,
  ludusUsername: string,
): Promise<LudusUserCheckResult> {
  const result = await ludusRequest<unknown>("/user", { apiKey })

  if (result.status === 401 || result.status === 403) {
    return { ok: false, kind: "unauthorized" }
  }

  if (result.error || result.status !== 200) {
    const detail = result.error || `HTTP ${result.status}`
    const message = isCertificateError(detail)
      ? `Cannot verify Ludus TLS certificate.${ludusTlsCertificateHint()}`
      : `Cannot reach Ludus API: ${detail}`
    return { ok: false, kind: "unreachable", message }
  }

  const profile = ludusCallerFromGetUser(result.data, ludusUsername)
  if (!profile) {
    return { ok: false, kind: "profile_mismatch" }
  }

  return { ok: true, isAdmin: profile.user.isAdmin }
}
