/**
 * Validate LUX createRange body before the API call / confirm.
 */

export type CreateRangeCheck =
  | { ok: true; rangeID: string; name: string; description?: string }
  | { ok: false; error: string; assistant_hint: string }

const FORBIDDEN_KEYS = ["extensions", "networkConfig", "network", "labName", "lab", "args"] as const

export function checkCreateRangeBody(body: unknown): CreateRangeCheck {
  if (!body || typeof body !== "object") {
    return {
      ok: false,
      error: "createRange requires a JSON body with rangeID and name.",
      assistant_hint:
        'call_lux_api createRange body: { "rangeID": "<user>-GOAD-Mini-<id>", "name": "<same>", "description": "…" }. ' +
        "No extensions/networkConfig fields. Then executeGoad with body.args string + rangeId.",
    }
  }
  const b = body as Record<string, unknown>
  const bad = FORBIDDEN_KEYS.filter((k) => b[k] !== undefined)
  if (bad.length > 0) {
    return {
      ok: false,
      error: `createRange does not accept: ${bad.join(", ")}. Only rangeID, name, description (optional).`,
      assistant_hint:
        "Ludus range create is separate from GOAD. " +
        'Body must be { rangeID, name, description? } only. ' +
        "Lab/extensions go in executeGoad body.args. Network rules: setRangeConfig or GOAD handoff after range exists — not createRange. " +
        "If range=new: ask_user for rangeID text first (suggest <user>-<Lab>-<shortId>).",
    }
  }
  const rangeID = typeof b.rangeID === "string" ? b.rangeID.trim() : ""
  const name = typeof b.name === "string" ? b.name.trim() : ""
  if (!rangeID || !name) {
    return {
      ok: false,
      error: "createRange requires non-empty rangeID and name.",
      assistant_hint:
        'Ask the user for the new range id via ask_user (type=text), or use pattern "<username>-GOAD-Mini-<4chars>". ' +
        'Then call_lux_api createRange with body: { "rangeID": "…", "name": "…", "description": "Dedicated Ludus range for GOAD-Mini" }. ' +
        "Do not invent extensions/networkConfig on this body.",
    }
  }
  const description = typeof b.description === "string" ? b.description : undefined
  return { ok: true, rangeID, name, description }
}
