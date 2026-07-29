import yaml from "js-yaml"
import fs from "fs"
import path from "path"
import { ludusRequest } from "@/lib/ludus-client"
import { LUDUS_OPS_CATALOG } from "./ludus-ops-catalog"
import { LUX_OPS_CATALOG } from "./lux-ops-catalog"

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete"

export interface OpenApiOperation {
  operationId: string
  method: HttpMethod
  path: string
  summary?: string
  description?: string
  tags?: string[]
  destructive: boolean
  /** Compact request body / query hints for describe_* tools. */
  callHints?: string
}

const DESTRUCTIVE_METHODS = new Set<HttpMethod>(["delete", "put", "patch"])
const DESTRUCTIVE_PATH_RE =
  /deploy|destroy|delete|power|testing|abort|purge|rm\b|force|remove|wipe|clear|reboot/i

export function isDestructiveOperation(method: HttpMethod, opPath: string, operationId?: string): boolean {
  if (method === "delete") return true
  if (DESTRUCTIVE_METHODS.has(method) && DESTRUCTIVE_PATH_RE.test(opPath)) return true
  if (operationId && DESTRUCTIVE_PATH_RE.test(operationId)) return true
  if (method === "post" && DESTRUCTIVE_PATH_RE.test(opPath)) return true
  // Packer build / abort — expensive, needs UI confirm (path alone does not match DESTRUCTIVE_PATH_RE).
  if (method === "post" && /^\/templates(\/abort)?$/.test(opPath)) return true
  return false
}

function summarizeCallHints(op: Record<string, unknown>): string | undefined {
  const bits: string[] = []
  const params = op.parameters
  if (Array.isArray(params)) {
    const q = params
      .filter((p): p is Record<string, unknown> => !!p && typeof p === "object" && p.in === "query")
      .map((p) => `${p.name}${p.required ? "*" : ""}`)
    if (q.length) bits.push(`query: ${q.join(", ")}`)
  }
  const rb = op.requestBody as
    | {
        content?: Record<string, { schema?: unknown }>
      }
    | undefined
  const schema =
    rb?.content?.["application/json"]?.schema ||
    (rb?.content && Object.values(rb.content)[0]?.schema)
  if (schema && typeof schema === "object") {
    const props = (schema as { properties?: Record<string, unknown> }).properties
    if (props) bits.push(`body fields: ${Object.keys(props).join(", ")}`)
    else bits.push(`body: ${JSON.stringify(schema).slice(0, 280)}`)
  }
  return bits.length ? bits.join(" | ") : undefined
}

function extractOpsFromSpec(spec: unknown, surface: "ludus" | "lux"): OpenApiOperation[] {
  if (!spec || typeof spec !== "object") return []
  const paths = (spec as { paths?: Record<string, Record<string, unknown>> }).paths
  if (!paths || typeof paths !== "object") return []
  const out: OpenApiOperation[] = []
  for (const [p, methods] of Object.entries(paths)) {
    if (!methods || typeof methods !== "object") continue
    for (const [methodRaw, op] of Object.entries(methods)) {
      const method = methodRaw.toLowerCase() as HttpMethod
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue
      if (!op || typeof op !== "object") continue
      const o = op as {
        operationId?: string
        summary?: string
        description?: string
        tags?: string[]
        parameters?: unknown
        requestBody?: unknown
      }
      const operationId =
        (typeof o.operationId === "string" && o.operationId) ||
        `${surface}_${method}_${p.replace(/[^\w]+/g, "_")}`
      out.push({
        operationId,
        method,
        path: p,
        summary: typeof o.summary === "string" ? o.summary : undefined,
        description: typeof o.description === "string" ? o.description : undefined,
        tags: Array.isArray(o.tags) ? o.tags.filter((t): t is string => typeof t === "string") : undefined,
        destructive: isDestructiveOperation(method, p, operationId),
        callHints: summarizeCallHints(o as Record<string, unknown>),
      })
    }
  }
  return out.sort((a, b) => a.operationId.localeCompare(b.operationId))
}

/** Ensure template register vs Packer-build ops stay obvious to the model. */
export function enrichTemplateOperationHints(ops: OpenApiOperation[], surface: "ludus" | "lux"): OpenApiOperation[] {
  return ops.map((o) => {
    if (surface === "lux") {
      if (o.operationId === "listTemplateSources" || o.path === "/api/templates/sources") {
        return {
          ...o,
          summary: "List template catalog (register helpers only — does NOT Packer-build)",
          callHints:
            (o.callHints ? `${o.callHints} | ` : "") +
            "REGISTER catalog only. After pick → addTemplates. Packer build = Ludus buildTemplates.",
        }
      }
      if (o.operationId === "addTemplates" || o.path === "/api/templates/add") {
        return {
          ...o,
          summary: "Register/install Packer files on Ludus (does NOT run Packer build)",
          callHints:
            (o.callHints ? `${o.callHints} | ` : "") +
            "body.templates[]={name,path,apiBase,ref}. Success/already-registered → still need Ludus buildTemplates.",
        }
      }
      if (o.operationId === "getGoadCatalog" || o.path === "/api/goad/catalog") {
        return {
          ...o,
          summary: "List GOAD labs — match by name (never labs[0]/ADFS)",
          callHints:
            (o.callHints ? `${o.callHints} | ` : "") +
            "Returns labNames + labs[].requiredTemplates + templateAudit. ask_user path lux_goad|ludus_blueprint first; PHASE 1 audit; in-chat wizard; executeGoad via call_lux_api with string body.args.",
        }
      }
      if (o.operationId === "executeGoad" || o.path === "/api/goad/execute") {
        return {
          ...o,
          summary: "Run GOAD CLI via SSE — requires body.args string (not labName, not array)",
          callHints:
            "call_lux_api only. REQUIRED body.args = one GOAD CLI string (not JSON array). Optional rangeId. " +
            "Complete ask_user wizard in goad-deploy.md first. " +
            "Fresh no extensions: `-l <ExactLabName> -p ludus -m local -t install`. " +
            "With extensions: playbook REPL pattern — do not invent.",
          destructive: true,
        }
      }
      if (o.operationId === "createRange" || o.path === "/api/range/create") {
        return {
          ...o,
          summary: "Create Ludus range for current user — body rangeID + name only",
          callHints:
            'REQUIRED body: { "rangeID": string, "name": string, "description"?: string }. ' +
            "FORBIDDEN: extensions, networkConfig, labName. " +
            "GOAD: ask_user for rangeID after choosing new range, then createRange, then executeGoad with same rangeId.",
        }
      }
      return o
    }
    // ludus
    if (o.method === "get" && o.path === "/templates") {
      return {
        ...o,
        operationId: o.operationId || "listTemplates",
        summary: o.summary?.includes("built")
          ? o.summary
          : "List registered templates (check built flag — register ≠ Packer build)",
        callHints:
          (o.callHints ? `${o.callHints} | ` : "") +
          "Use exact name for buildTemplates. To ADD from source use LUX addTemplates first.",
      }
    }
    if (o.method === "post" && o.path === "/templates") {
      return {
        ...o,
        operationId: /build/i.test(o.operationId) ? o.operationId : "buildTemplates",
        summary: "Packer-build already-registered template(s) → Proxmox SHARED",
        destructive: true,
        callHints:
          "body: { templates: [\"exact-name-from-listTemplates\"] }. NOT add-from-source (that is LUX addTemplates).",
      }
    }
    if (o.method === "post" && o.path === "/templates/abort") {
      return {
        ...o,
        summary: o.summary || "Abort running Packer template build",
        destructive: true,
      }
    }
    if (o.path === "/range/poweron" || o.path === "/range/poweroff") {
      const off = o.path === "/range/poweroff"
      return {
        ...o,
        operationId: o.operationId || (off ? "powerOffRange" : "powerOnRange"),
        summary: o.summary || (off ? "Power off range VMs" : "Power on range VMs"),
        destructive: true,
        tags: [...new Set([...(o.tags || []), "power", "range"])],
        callHints:
          'query: rangeID* (not pathParams); body: { machines: ["all"] } or VM names. ' +
          (o.callHints || ""),
      }
    }
    return o
  })
}

/** Merge live OpenAPI ops with a static catalog — catalog fills gaps; live wins same method+path. */
export function mergeOpsWithCatalog(
  live: OpenApiOperation[],
  catalog: OpenApiOperation[],
): OpenApiOperation[] {
  const byKey = new Map<string, OpenApiOperation>()
  for (const o of catalog) {
    byKey.set(`${o.method}:${o.path}`, { ...o })
  }
  for (const o of live) {
    const k = `${o.method}:${o.path}`
    const cat = byKey.get(k)
    if (!cat) {
      byKey.set(k, { ...o })
      continue
    }
    byKey.set(k, {
      ...cat,
      ...o,
      operationId: o.operationId || cat.operationId,
      summary: o.summary || cat.summary,
      description: o.description || cat.description,
      callHints: o.callHints || cat.callHints,
      tags: o.tags?.length ? o.tags : cat.tags,
      destructive: o.destructive || cat.destructive,
    })
  }
  return [...byKey.values()].sort((a, b) => a.operationId.localeCompare(b.operationId))
}

/**
 * Normalize model args for known Ludus quirks (power uses query.rangeID + body.machines).
 */
export function normalizeLudusCallArgs(
  op: OpenApiOperation,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (op.path !== "/range/poweron" && op.path !== "/range/poweroff") return args

  const pathParams =
    args.pathParams && typeof args.pathParams === "object"
      ? ({ ...(args.pathParams as Record<string, unknown>) } as Record<string, unknown>)
      : {}
  const query =
    args.query && typeof args.query === "object"
      ? ({ ...(args.query as Record<string, unknown>) } as Record<string, unknown>)
      : {}

  const rangeId =
    query.rangeID ??
    query.rangeId ??
    pathParams.rangeID ??
    pathParams.rangeId ??
    args.rangeID ??
    args.rangeId
  if (rangeId != null && String(rangeId).trim()) {
    query.rangeID = String(rangeId).trim()
  }
  delete pathParams.rangeID
  delete pathParams.rangeId

  let body: unknown = args.body
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    body = { machines: ["all"] }
  } else {
    const b = { ...(body as Record<string, unknown>) }
    const machines = b.machines
    if (!Array.isArray(machines) || machines.length === 0) {
      b.machines = ["all"]
    }
    body = b
  }

  const next: Record<string, unknown> = { ...args, query, body }
  if (Object.keys(pathParams).length) next.pathParams = pathParams
  else delete next.pathParams
  return next
}

/** Synonym expansion so list_* query=power|off|shutdown finds power ops. */
const FILTER_ALIASES: Record<string, string[]> = {
  power: ["poweron", "poweroff", "power"],
  off: ["poweroff", "power"],
  on: ["poweron", "power"],
  shutdown: ["poweroff", "power"],
  start: ["poweron", "testing/start"],
  stop: ["poweroff", "testing/stop", "abort"],
  vm: ["power", "vm", "range"],
  snapshot: ["snapshot"],
  testing: ["testing", "allow", "deny"],
  wireguard: ["wireguard"],
  vpn: ["wireguard"],
  group: ["group"],
  ansible: ["ansible", "role", "collection"],
  blueprint: ["blueprint"],
  template: ["template"],
  goad: ["goad"],
  source: ["source", "blueprint"],
}

function expandFilterQuery(q: string): string[] {
  const base = q.trim().toLowerCase()
  if (!base) return []
  const out = new Set<string>([base])
  const direct = FILTER_ALIASES[base]
  if (direct) for (const t of direct) out.add(t)
  for (const [k, vs] of Object.entries(FILTER_ALIASES)) {
    if (base.includes(k) || k.includes(base)) {
      out.add(k)
      for (const t of vs) out.add(t)
    }
  }
  return [...out]
}

function ensureLudusTemplateFallbackOps(ops: OpenApiOperation[]): OpenApiOperation[] {
  const hasList = ops.some((o) => o.method === "get" && o.path === "/templates")
  const hasBuild = ops.some((o) => o.method === "post" && o.path === "/templates")
  const hasLogs = ops.some((o) => o.method === "get" && o.path === "/templates/logs")
  const extra: OpenApiOperation[] = []
  if (!hasList) {
    extra.push({
      operationId: "listTemplates",
      method: "get",
      path: "/templates",
      summary: "List registered templates (check built flag — register ≠ Packer build)",
      destructive: false,
    })
  }
  if (!hasBuild) {
    extra.push({
      operationId: "buildTemplates",
      method: "post",
      path: "/templates",
      summary: "Packer-build already-registered template(s) → Proxmox SHARED",
      destructive: true,
    })
  }
  if (!hasLogs) {
    extra.push({
      operationId: "getTemplateLogs",
      method: "get",
      path: "/templates/logs",
      summary: "Read live Packer build log output (after buildTemplates started)",
      destructive: false,
      callHints: "Read-only. After build starts, peek here then tell user to open /templates. Do not POST /templates again.",
    })
  }
  return extra.length ? [...ops, ...extra] : ops
}

let luxOpsCache: OpenApiOperation[] | null = null
let ludusOpsCache: { at: number; ops: OpenApiOperation[] } | null = null
const LUDUS_TTL_MS = 60 * 60_000

export function loadLuxOpenApiOperations(): OpenApiOperation[] {
  if (luxOpsCache) return luxOpsCache
  let fromYaml: OpenApiOperation[] = []
  const candidates = [
    path.join(process.cwd(), "docs", "openapi.yaml"),
    path.join(process.cwd(), "..", "docs", "openapi.yaml"),
  ]
  for (const fp of candidates) {
    if (!fs.existsSync(fp)) continue
    try {
      const doc = yaml.load(fs.readFileSync(fp, "utf8"))
      fromYaml = extractOpsFromSpec(doc, "lux")
      break
    } catch (err) {
      console.warn("[assistant] Failed to parse LUX openapi.yaml:", err)
    }
  }
  luxOpsCache = enrichTemplateOperationHints(
    mergeOpsWithCatalog(fromYaml, LUX_OPS_CATALOG),
    "lux",
  )
  return luxOpsCache
}

export async function loadLudusOpenApiOperations(apiKey: string): Promise<OpenApiOperation[]> {
  if (ludusOpsCache && Date.now() - ludusOpsCache.at < LUDUS_TTL_MS) {
    return ludusOpsCache.ops
  }
  let live: OpenApiOperation[] = []
  const res = await ludusRequest<unknown>("/openapi", { apiKey, timeout: 20_000 })
  if (res.data) {
    live = extractOpsFromSpec(res.data, "ludus")
  }
  const merged = enrichTemplateOperationHints(
    ensureLudusTemplateFallbackOps(mergeOpsWithCatalog(live, LUDUS_OPS_CATALOG)),
    "ludus",
  )
  ludusOpsCache = { at: Date.now(), ops: merged }
  return merged
}

export function filterOperations(
  ops: OpenApiOperation[],
  query?: string,
  limit = 40,
): OpenApiOperation[] {
  const q = (query || "").trim().toLowerCase()
  if (!q) return ops.slice(0, limit)
  const terms = expandFilterQuery(q)
  const filtered = ops.filter((o) => {
    const hay = [
      o.operationId,
      o.path,
      o.summary || "",
      ...(o.tags || []),
      o.callHints || "",
    ]
      .join(" ")
      .toLowerCase()
    return terms.some((t) => hay.includes(t))
  })
  return filtered.slice(0, limit)
}

export function findOperation(ops: OpenApiOperation[], operationId: string): OpenApiOperation | undefined {
  const raw = operationId.trim()
  if (!raw) return undefined
  const want = raw.toLowerCase()

  const byId = ops.find((o) => o.operationId.toLowerCase() === want)
  if (byId) return byId

  // Common aliases models invent
  const aliases: Record<string, string> = {
    poweroff: "powerOffRange",
    poweroffrange: "powerOffRange",
    poweron: "powerOnRange",
    poweronrange: "powerOnRange",
    shutdownrange: "powerOffRange",
    startvms: "powerOnRange",
    stopvms: "powerOffRange",
  }
  const aliasId = aliases[want.replace(/[^a-z]/g, "")]
  if (aliasId) {
    const hit = ops.find((o) => o.operationId.toLowerCase() === aliasId.toLowerCase())
    if (hit) return hit
  }

  // Models often pass "GET /api/templates/sources" from list output instead of operationId.
  const methodPath = want.match(/^(get|post|put|patch|delete)\s+(\/\S+)$/i)
  if (methodPath) {
    const method = methodPath[1].toLowerCase()
    const path = methodPath[2]
    const hit = ops.find((o) => o.method === method && o.path.toLowerCase() === path)
    if (hit) return hit
  }

  // Path-only: "/api/templates/sources" when unique among ops.
  if (want.startsWith("/")) {
    const pathHits = ops.filter((o) => o.path.toLowerCase() === want)
    if (pathHits.length === 1) return pathHits[0]
  }

  return undefined
}

/** Substitute `{param}` path templates from args.pathParams or top-level args. */
export function buildRequestPath(
  template: string,
  args: Record<string, unknown> | undefined,
): string {
  const params =
    (args?.pathParams as Record<string, unknown> | undefined) ||
    (args?.params as Record<string, unknown> | undefined) ||
    {}
  return template.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const v = params[key] ?? args?.[key]
    return encodeURIComponent(String(v ?? ""))
  })
}

export type AssistantToolName =
  | "list_ludus_operations"
  | "describe_ludus_operation"
  | "call_ludus_api"
  | "list_lux_operations"
  | "describe_lux_operation"
  | "call_lux_api"
  | "ask_user"
  | "search_documentation"
  | "fetch_ludus_doc"
  | "read_documentation"

export const ASSISTANT_TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "list_ludus_operations",
      description:
        "List Ludus /api/v2 operations (full catalog: range, power on/off, templates, ansible, testing, snapshots, blueprints, groups, users). Filter with query e.g. power, snapshot, testing. Template register-from-source is LUX (list_lux_operations query=template).",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Filter: power|off|on|snapshot|testing|template|ansible|blueprint|group|user|deploy|…",
          },
          limit: { type: "number", description: "Max results (default 40)" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "describe_ludus_operation",
      description: "Get details + callHints for one Ludus operationId (e.g. powerOffRange, deployRange).",
      parameters: {
        type: "object",
        properties: { operationId: { type: "string" } },
        required: ["operationId"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "call_ludus_api",
      description:
        "Call a Ludus /api/v2 operation. operationId = camelCase id (powerOffRange, listTemplates). Power: query.rangeID + body.machines (not pathParams). Never invent ids.",
      parameters: {
        type: "object",
        properties: {
          operationId: {
            type: "string",
            description: "Exact camelCase operationId from list/describe (e.g. powerOffRange). Do not pass METHOD + path.",
          },
          pathParams: { type: "object" },
          query: { type: "object" },
          body: {},
          confirmToken: { type: "string", description: "Required after user confirms a destructive call" },
        },
        required: ["operationId"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_lux_operations",
      description:
        "List Ludus UX /api/* operations (GOAD, console, templates register, sources, blueprints helpers, range helpers, admin, settings). Returns camelCase operationIds for call_lux_api.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Filter: goad|template|source|console|range|assistant|…" },
          limit: { type: "number", description: "Max results (default 40)" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "describe_lux_operation",
      description: "Get details + callHints for one LUX camelCase operationId (e.g. listTemplateSources) before calling it.",
      parameters: {
        type: "object",
        properties: { operationId: { type: "string" } },
        required: ["operationId"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "call_lux_api",
      description:
        "Call a LUX /api/* route. operationId = camelCase id only (listTemplateSources, addTemplates). Never pass 'GET /api/templates/sources'. Prefer for GOAD, console, template add-from-source.",
      parameters: {
        type: "object",
        properties: {
          operationId: {
            type: "string",
            description: "Exact camelCase id, e.g. listTemplateSources or addTemplates — not METHOD + path",
          },
          pathParams: { type: "object" },
          query: { type: "object" },
          body: {},
          confirmToken: { type: "string" },
        },
        required: ["operationId"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "ask_user",
      description:
        "REQUIRED for any multiple-choice question (path, extensions, range, network, confirm, blueprint vs LUX, etc.). Shows button UI and waits. NEVER ask those choices in chat prose / numbered lists — that fails the UX. ONLY after reading the matching workflow playbook (skills/ludus-ux/references/workflows/INDEX.md → topic file). Copy option ids/labels from that playbook — never invent flags like --dedicated. After calling, STOP and wait.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short card title, e.g. GOAD deploy" },
          message: { type: "string", description: "Optional intro under the title" },
          questions: {
            type: "array",
            description: "1–8 questions shown on one card",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "Stable id for this answer, e.g. extensions" },
                prompt: { type: "string", description: "Question shown to the user" },
                type: {
                  type: "string",
                  enum: ["single", "multi", "text"],
                  description: "single = one button; multi = many; text = free text only",
                },
                options: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      label: { type: "string" },
                    },
                    required: ["id", "label"],
                  },
                },
                allowCustom: {
                  type: "boolean",
                  description: "Also show a free-text field (single/multi)",
                },
                required: { type: "boolean" },
              },
              required: ["id", "prompt", "type"],
            },
          },
        },
        required: ["title", "questions"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_documentation",
      description:
        "Search Ludus UX docs, skill references, and cached Ludus docs. Use hit.path exactly with read_documentation — do not invent paths.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Keywords, e.g. deploy tags, GOAD, range config" },
          limit: { type: "number", description: "Max hits (default 8)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "fetch_ludus_doc",
      description:
        "Fetch a page from https://docs.ludus.cloud/docs/* into the local cache, then you can search/read it. Use when search misses or the user cites a docs URL.",
      parameters: {
        type: "object",
        properties: {
          urlOrPath: {
            type: "string",
            description: "Full URL or path like /docs/configuration or docs/cli",
          },
          seed: {
            type: "boolean",
            description: "If true, seed the curated core Ludus docs set into the cache",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "read_documentation",
      description:
        "Read a documentation file. path MUST be the exact hit.path from search_documentation (e.g. skills/ludus-ux/references/environment-guide.md).",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Exact path from search hit" },
          maxChars: { type: "number", description: "Max characters to return (default 6000)" },
        },
        required: ["path"],
      },
    },
  },
]
