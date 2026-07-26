/** Whether a successful Ludus proxy mutation should trigger ~/.ansible layout repair. */

function isInstallAction(body: unknown): boolean {
  if (body == null || typeof body !== "object" || Array.isArray(body)) return false
  const action = (body as Record<string, unknown>).action
  return action === undefined || action === "install"
}

export function shouldRepairAnsibleHomeAfterProxyMutation(
  method: string,
  basePath: string,
  body: unknown,
): boolean {
  if (method !== "POST") return false

  if (basePath === "/ansible/subscription-roles") {
    return isInstallAction(body)
  }

  if (/^\/blueprints\/[^/]+\/install$/.test(basePath)) {
    return true
  }

  if (/^\/sources\/[^/]+\/(sync|install)$/.test(basePath)) {
    return true
  }

  if (basePath.startsWith("/ansible/") && isInstallAction(body)) {
    return true
  }

  return false
}
