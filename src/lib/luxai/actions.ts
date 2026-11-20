import type { NextRequest } from "next/server"
import { cookieImpersonation } from "@/lib/admin/admin-impersonation-request"
import { getInstanceIdForRange } from "@/lib/goad/goad-instance-range-store"
import { assertGoadInstanceAccess } from "@/lib/goad/goad-instance-access"
import { discoverGoadCatalog, getInstanceInventories, isGoadConfigured, sshExec } from "@/lib/goad/goad-ssh"
import { launchGoadInstall } from "@/lib/luxai/goad-launch"
import { ludusFetch } from "@/lib/ludus/ludus-fetch"
import { ludusGet, ludusPost, ludusPut, ludusRequest } from "@/lib/ludus/ludus-client"
import { ludusCallerFromGetUser } from "@/lib/ludus/ludus-user-from-profile"
import { setOwnership } from "@/lib/range/range-ownership-store"
import { getSettings } from "@/lib/settings/settings-store"
import { liveSessionIsAdmin } from "@/lib/session/session-admin-check"
import type { ResolvedSession } from "@/lib/session/session"
import { presentCommandOutput } from "@/lib/luxai/command-output"
import { htmlToText } from "@/lib/luxai/html-text"
import { LUXAI_LIMITS } from "@/lib/luxai/defaults"
import { clipText, redactSecrets, scrubSecret } from "@/lib/luxai/redact"
import { rangeCreateKeys, rangeCreateNeedsAdminKey } from "@/lib/luxai/range-create-auth"
import { guestAnsibleStdin } from "@/lib/luxai/guest-stdin"
import { configWithGoadRules, goadRulesSnapshotJson } from "@/lib/luxai/goad-rules"
import type { RangeRuleDraft } from "@/lib/luxai/range-vms"
import { ensureLuxHostCurrent } from "@/lib/lux/lux-host-sync"
import type { DeploySpec, LuxaiHost } from "@/lib/luxai/tools"

const DOC_URLS: Record<string, string> = {
  configuration: "https://docs.ludus.cloud/docs/configuration/",
  mcp: "https://docs.ludus.cloud/docs/using-ludus/mcp/",
  "quick-start": "https://docs.ludus.cloud/docs/category/quick-start/",
}

function ludusError(status: number, error: string | undefined, apiKey: string): Error {
  const detail = scrubSecret(error || `HTTP ${status}`, apiKey).slice(0, 300)
  if (status === 401 || status === 403 || status === 404) {
    return new Error("That range is not available to this user.")
  }
  return new Error(detail || "Ludus request failed.")
}

function configText(data: unknown): string {
  if (data && typeof data === "object" && typeof (data as { result?: unknown }).result === "string") {
    return (data as { result: string }).result
  }
  if (typeof data === "string") return data
  throw new Error("Ludus did not return a range config.")
}

async function putRangeConfig(apiKey: string, rangeId: string, yamlText: string): Promise<void> {
  const settings = getSettings()
  const base = settings.ludusUrl.trim().replace(/\/$/, "")
  const form = new FormData()
  form.append("file", new Blob([yamlText], { type: "application/x-yaml" }), "range-config.yml")
  form.append("force", "true")
  const url = `${base}/api/v2/range/config?rangeID=${encodeURIComponent(rangeId)}`
  const response = await ludusFetch(url, {
    method: "PUT",
    headers: { "X-API-KEY": apiKey },
    body: form,
    cache: "no-store",
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null
    throw ludusError(response.status, body?.error, apiKey)
  }
}

export function createLiveHost(session: ResolvedSession, request: NextRequest): LuxaiHost {
  return {
    async listRanges(apiKey) {
      const result = await ludusGet<unknown>("/ranges/accessible", { apiKey })
      if (result.error || result.status >= 400) throw ludusError(result.status, result.error, apiKey)
      return result.data
    },
    async readRange(apiKey, rangeId) {
      const result = await ludusGet<unknown>(`/range?rangeID=${encodeURIComponent(rangeId)}`, { apiKey })
      if (result.error || result.status >= 400 || result.data == null) {
        throw ludusError(result.status, result.error, apiKey)
      }
      return result.data
    },
    async readConfig(apiKey, rangeId) {
      const result = await ludusGet<unknown>(`/range/config?rangeID=${encodeURIComponent(rangeId)}`, { apiKey })
      if (result.error || result.status >= 400) throw ludusError(result.status, result.error, apiKey)
      return configText(result.data)
    },
    writeConfig: putRangeConfig,
    async power(apiKey, rangeId, mode, machines) {
      const path = mode === "on" ? "poweron" : "poweroff"
      const result = await ludusPut(
        `/range/${path}?rangeID=${encodeURIComponent(rangeId)}`,
        { machines },
        { apiKey },
      )
      if (result.error || result.status >= 400) throw ludusError(result.status, result.error, apiKey)
    },
    async deploy(apiKey, rangeId, spec: DeploySpec) {
      const body: Record<string, unknown> = {}
      if (spec.tags.length > 0) body.tags = spec.tags.join(",")
      if (spec.limit) body.limit = spec.limit
      if (spec.onlyRoles.length > 0) body.only_roles = spec.onlyRoles
      if (spec.force) body.force = true
      const result = await ludusPost(
        `/range/deploy?rangeID=${encodeURIComponent(rangeId)}`,
        Object.keys(body).length > 0 ? body : undefined,
        { apiKey },
      )
      if (result.error || result.status >= 400) throw ludusError(result.status, result.error, apiKey)
    },
    async readInventory(apiKey, rangeId) {
      const result = await ludusGet<unknown>(
        `/range/ansibleinventory?rangeID=${encodeURIComponent(rangeId)}`,
        { apiKey, timeout: 120_000 },
      )
      if (result.error || result.status >= 400) throw ludusError(result.status, result.error, apiKey)
      return configText(result.data)
    },
    async runGuest(apiKey, rangeId, host, module, command) {
      const stdin = guestAnsibleStdin(apiKey, command)
      const synced = await ensureLuxHostCurrent()
      if (!synced.ok) throw new Error(synced.detail)
      let result: { stdout: string; stderr: string; code: number }
      try {
        result = await sshExec(["guest-ansible", rangeId, host, module], undefined, { stdin })
      } catch (err) {
        const message = err instanceof Error ? err.message : "Guest command failed."
        throw new ChangeStartedError(scrubSecret(message, apiKey).slice(0, 500))
      }
      const output = scrubSecret(`${result.stdout}\n${result.stderr}`.trim(), apiKey)
      const shown = presentCommandOutput(output)
      if (result.code !== 0) {
        throw new ChangeStartedError(clipText(shown || `guest command exited ${result.code}`, LUXAI_LIMITS.outputMax))
      }
      return clipText(shown, LUXAI_LIMITS.outputMax)
    },
    async describeGoad(rangeId) {
      const instanceId = getInstanceIdForRange(rangeId)
      if (!instanceId) return "No GOAD instance is linked to this range in LUX."
      const impersonation = cookieImpersonation(session)
      const asOperator = impersonation.apiKey
        ? (impersonation.sshLogin || impersonation.ludusPrincipal || undefined)
        : undefined
      const denied = await assertGoadInstanceAccess(
        session,
        request,
        instanceId,
        asOperator ? { asOperator } : {},
      )
      if (denied) return "This user cannot read that GOAD instance."
      const inventories = await getInstanceInventories(instanceId)
      const names = inventories.map((file) => file.name || file.path || "inventory").join(", ")
      const body = inventories
        .map((file) => `## ${file.name || "inventory"}\n${redactSecrets(file.content || "")}`)
        .join("\n\n")
      return clipText(`GOAD instance ${instanceId}. Inventories: ${names || "none"}.\n\n${body}`, LUXAI_LIMITS.outputMax)
    },
    async listGoadCatalog() {
      if (!isGoadConfigured()) return "GOAD is not configured on this server."
      const creds = session.sshPassword
        ? { username: session.username, password: session.sshPassword }
        : undefined
      const catalog = await discoverGoadCatalog(creds)
      const labs = catalog.labs.map((lab) => lab.name).join(", ") || "none"
      const extensions = catalog.extensions.map((ext) => ext.name).join(", ") || "none"
      return `Labs: ${labs}\nExtensions: ${extensions}`
    },
    async createRange(apiKey, rangeId, name) {
      const impersonation = cookieImpersonation(session)
      const hint = impersonation.apiKey && impersonation.apiKey === apiKey
        ? (impersonation.ludusUserId || impersonation.ludusPrincipal || session.username)
        : session.username
      const who = await ludusRequest<unknown>("/user", { apiKey })
      if (who.error || who.status !== 200) throw new Error(who.error || "Could not read the Ludus user.")
      const caller = ludusCallerFromGetUser(who.data, hint)
      if (!caller?.userId) throw new Error("Could not read the Ludus user id for this account.")
      const keys = rangeCreateKeys(apiKey, getSettings().rootApiKey)
      if (keys.length === 0) throw new Error("No Ludus API key for range creation. Log in with a Ludus API key, or set the root key in Settings.")
      let createdKey = ""
      let lastError = "Range creation failed."
      for (const createKey of keys) {
        const created = await ludusRequest<unknown>("/ranges/create", {
          method: "POST",
          apiKey: createKey,
          useAdminEndpoint: true,
          body: { rangeID: rangeId, name, userID: [caller.userId] },
        })
        if (!created.error && created.status < 400) {
          createdKey = createKey
          break
        }
        lastError = created.error || `HTTP ${created.status}`
        if (/already in use|already exists/i.test(lastError)) {
          const existing = await ludusGet<unknown>(`/range?rangeID=${encodeURIComponent(rangeId)}`, { apiKey })
          if (!existing.error && existing.status < 400) {
            createdKey = createKey
            break
          }
        }
        if (!rangeCreateNeedsAdminKey(created.error, created.status)) throw new Error(lastError)
      }
      if (!createdKey) {
        throw new Error("This account cannot create a range on the admin API. Set the root API key in Settings so LUX can create it for this user.")
      }
      // CreateRange grants payload.userID access. /ranges/assign is admin-only and rejects this user.
      setOwnership(rangeId, caller.userId, session.username)
    },
    async deleteRange(apiKey, rangeId) {
      const removed = await ludusRequest(`/range?rangeID=${encodeURIComponent(rangeId)}&force=true`, {
        method: "DELETE",
        apiKey,
      })
      if (removed.error || removed.status >= 400) throw new Error(removed.error || "Range delete failed.")
    },
    async startGoadDeploy(_apiKey, rangeId, args, networkRulesJson) {
      const taskId = await launchGoadInstall({
        request,
        session,
        apiKey: _apiKey,
        rangeId,
        args,
        networkRulesJson,
      })
      return taskId
    },
    async fetchDoc(slug) {
      const url = DOC_URLS[slug]
      if (!url) throw new Error("Unknown doc slug. Use configuration, mcp, or quick-start.")
      const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(8_000) })
      if (response.status >= 300 && response.status < 400) {
        throw new Error("The doc URL redirected. LUXAI did not follow it.")
      }
      if (!response.ok) throw new Error(`Ludus docs returned HTTP ${response.status}.`)
      const html = await response.text()
      return htmlToText(html).slice(0, 8_000)
    },
  }
}


export class ChangeStartedError extends Error {
  /** When true, Apply can be pressed again. A sent guest, power, or deploy command stays applied. */
  readonly retryable: boolean
  constructor(message: string, retryable = false) {
    super(message)
    this.name = "ChangeStartedError"
    this.retryable = retryable
  }
}

/** Chat owner is the login name, or the impersonated Ludus user id from the cookie. */
export async function luxaiActor(
  session: ResolvedSession,
  _request: NextRequest,
): Promise<{ username: string; apiKey: string }> {
  if (await liveSessionIsAdmin(session)) {
    const impersonation = cookieImpersonation(session)
    const owner = impersonation.ludusUserId || impersonation.ludusPrincipal
    if (impersonation.apiKey && owner) {
      return { username: owner, apiKey: impersonation.apiKey }
    }
  }
  return { username: session.username, apiKey: session.apiKey }
}

export async function applyStoredChange(
  kind: "range_config" | "power" | "deploy" | "guest_command" | "goad_deploy" | "range_create" | "range_delete",
  rangeId: string,
  beforeText: string,
  afterText: string,
  host: LuxaiHost,
  apiKey: string,
): Promise<string> {
  if (kind === "range_config") {
    const live = await host.readConfig(apiKey, rangeId)
    if (live !== beforeText) {
      throw new Error("The range config changed after this proposal. Reject it and propose again.")
    }
    try {
      await host.writeConfig(apiKey, rangeId, afterText)
    } catch (err) {
      throw new ChangeStartedError(err instanceof Error ? err.message : "Upload failed.", true)
    }
    return "Range config uploaded. The previous copy can be restored."
  }
  if (kind === "power") {
    const spec = JSON.parse(afterText) as { mode?: string; machines?: string[] }
    const mode = spec.mode === "off" ? "off" : "on"
    try {
      await host.power(apiKey, rangeId, mode, Array.isArray(spec.machines) ? spec.machines : [])
    } catch (err) {
      throw new ChangeStartedError(err instanceof Error ? err.message : "Power request failed.")
    }
    return "Power request sent. This entry cannot be reverted automatically."
  }
  if (kind === "deploy") {
    const spec = JSON.parse(afterText) as DeploySpec
    try {
      await host.deploy(apiKey, rangeId, spec)
    } catch (err) {
      throw new ChangeStartedError(err instanceof Error ? err.message : "Deploy failed.")
    }
    return "Deploy started. This entry cannot be reverted automatically."
  }
  if (kind === "goad_deploy") {
    const spec = JSON.parse(afterText) as {
      args?: string
      create?: { name?: string; rangeId?: string } | null
      rules?: RangeRuleDraft[]
    }
    if (spec.create?.rangeId && spec.create.name) {
      await host.createRange(apiKey, spec.create.rangeId, spec.create.name)
    }
    if (!spec.args) throw new Error("The stored GOAD deploy is incomplete.")
    const targetRange = spec.create?.rangeId || rangeId
    const rules = Array.isArray(spec.rules) ? spec.rules : []
    if (rules.length > 0) {
      try {
        const live = await host.readConfig(apiKey, targetRange).catch(() => "")
        await host.writeConfig(apiKey, targetRange, configWithGoadRules(live, rules))
      } catch (err) {
        throw new ChangeStartedError(err instanceof Error ? err.message : "The range was created, but the firewall rules were not saved.", true)
      }
    }
    const taskId = await host.startGoadDeploy(apiKey, targetRange, spec.args, goadRulesSnapshotJson(rules) ?? undefined)
    return `GOAD deploy started as task ${taskId}. Open GOAD to watch it. This entry cannot be reverted automatically.`
  }
  if (kind === "range_create") {
    const spec = JSON.parse(afterText) as { name?: string; rangeId?: string; yaml?: string; deploy?: boolean; rules?: RangeRuleDraft[] }
    if (!spec.rangeId || !spec.name) throw new Error("The stored range is incomplete.")
    await host.createRange(apiKey, spec.rangeId, spec.name)
    const rulesYaml = !spec.yaml?.trim() && Array.isArray(spec.rules) && spec.rules.length > 0
      ? configWithGoadRules(await host.readConfig(apiKey, spec.rangeId).catch(() => ""), spec.rules)
      : ""
    const configYaml = spec.yaml?.trim() || rulesYaml
    if (configYaml) {
      try {
        await host.writeConfig(apiKey, spec.rangeId, configYaml)
      } catch (err) {
        throw new ChangeStartedError(err instanceof Error ? err.message : "The range was created, but the config upload failed.", true)
      }
    }
    if (spec.deploy) {
      try {
        await host.deploy(apiKey, spec.rangeId, { tags: [], limit: "", onlyRoles: [], force: false })
      } catch (err) {
        throw new ChangeStartedError(err instanceof Error ? err.message : "The range was created, but the deploy did not start.")
      }
    }
    const uploaded = Boolean(configYaml)
    if (spec.deploy && uploaded) return `Range ${spec.rangeId} created, the config uploaded, and a full deploy started. This entry cannot be reverted automatically.`
    if (spec.deploy) return `Range ${spec.rangeId} created and a full deploy started. This entry cannot be reverted automatically.`
    if (uploaded) return `Range ${spec.rangeId} created and the config uploaded. This entry cannot be reverted automatically.`
    return `Range ${spec.rangeId} created. This entry cannot be reverted automatically.`
  }
  if (kind === "range_delete") {
    await host.deleteRange(apiKey, rangeId)
    return `Range ${rangeId} deleted. This entry cannot be reverted automatically.`
  }
  const spec = JSON.parse(afterText) as { host?: string; module?: string; command?: string }
  if (!spec.host || !spec.module || !spec.command) throw new Error("The stored guest command is incomplete.")
  const output = await host.runGuest(apiKey, rangeId, spec.host, spec.module, spec.command)
  return clipText(output || "Command finished with no output.", LUXAI_LIMITS.outputMax)
}

export async function revertStoredChange(
  kind: string,
  rangeId: string,
  beforeText: string,
  afterText: string,
  host: LuxaiHost,
  apiKey: string,
): Promise<string> {
  if (kind !== "range_config") {
    throw new Error("This change cannot be reverted automatically. The journal still has the command or request.")
  }
  const live = await host.readConfig(apiKey, rangeId)
  if (live !== afterText) {
    throw new Error("The range config no longer matches the applied copy, so it was left as it is.")
  }
  await host.writeConfig(apiKey, rangeId, beforeText)
  return "Previous range config restored."
}
