import { ludusRequest } from "./ludus-client"
import { ludusCallerFromGetUser } from "./ludus-user-from-profile"
import { isLudusTlsInsecure } from "./tls-insecure-env"

export type LudusUserCheckResult =
  | { ok: true; isAdmin: boolean }
  | { ok: false; kind: "unauthorized" }
  | { ok: false; kind: "profile_mismatch" }
  | { ok: false; kind: "unreachable"; message: string }

function tlsHint(): string {
  if (isLudusTlsInsecure()) return ""
  return " If Ludus uses a self-signed certificate, set LUDUS_TLS_INSECURE=true in .env (lab only) or add the CA via NODE_EXTRA_CA_CERTS."
}

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
    const isTls =
      /unable to verify the first certificate|self[- ]signed|certificate/i.test(detail)
    const message = isTls
      ? `Cannot verify Ludus TLS certificate.${tlsHint()}`
      : `Cannot reach Ludus API: ${detail}`
    return { ok: false, kind: "unreachable", message }
  }

  const profile = ludusCallerFromGetUser(result.data, ludusUsername)
  if (!profile) {
    return { ok: false, kind: "profile_mismatch" }
  }

  return { ok: true, isAdmin: profile.user.isAdmin }
}
