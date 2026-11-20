import type { LuxaiChoice, LuxaiChoiceField, LuxaiChoiceOption } from "@/lib/luxai/types"

/** Template and CA attributes LUXAI can set. Each line is the setting, not how to use it. */
export const ADCS_CONFIGURATIONS: Array<{ id: string; detail: string }> = [
  { id: "ESC15", detail: "Schema version 1, and the enrollee-supplies-subject name flag (0x1)." },
  { id: "ESC1", detail: "Schema version 2 or higher, the enrollee-supplies-subject name flag (0x1), and the Client Authentication EKU." },
  { id: "ESC2", detail: "The Any Purpose EKU, or no EKU, on the template." },
  { id: "ESC3", detail: "The Certificate Request Agent EKU on the template." },
  { id: "ESC6", detail: "The CA policy flag EDITF_ATTRIBUTESUBJECTALTNAME2." },
  { id: "ESC9", detail: "The template flag that omits the security extension." },
  { id: "ESC16", detail: "The CA disables the security extension OID." },
]

export interface AskRangeChoice {
  id: string
  name: string
}

export function fillAskFields(
  choice: LuxaiChoice,
  input: { ranges: AskRangeChoice[]; userText?: string },
): LuxaiChoice {
  const userText = input.userText ?? ""
  const fields = (choice.fields ?? []).map((field) => fillField(field, choice.prompt, input.ranges, userText))
  return { ...choice, fields }
}

function fillField(
  field: LuxaiChoiceField,
  prompt: string,
  ranges: AskRangeChoice[],
  userText: string,
): LuxaiChoiceField {
  if (isExistingRangeField(field) && ranges.length > 0) {
    const ordered = preferRanges(ranges, userText)
    return { ...field, kind: "select", label: field.label || "Range", options: rangeOptions(ordered) }
  }
  if (isAdcsConfigField(field, prompt)) {
    const options = prefer(adcsOptions(), (option) => new RegExp(`\\b${option.id}\\b`, "i").test(userText))
    return { ...field, kind: "select", label: field.label || "AD CS configuration", options }
  }
  return field
}

export function isExistingRangeField(field: { id: string; label: string }): boolean {
  const blob = `${field.id} ${field.label}`.toLowerCase()
  if (/\bnew\b/.test(blob)) return false
  const id = field.id.toLowerCase().replace(/[_-]/g, "")
  if (id === "range" || id === "rangeid") return true
  return /range[\s_-]*id|which range/.test(blob)
}

export function isAdcsConfigField(field: { id: string; label: string }, prompt: string): boolean {
  const blob = `${field.id} ${field.label}`.toLowerCase()
  if (/ad\s*cs|adcs|\besc\d*\b/.test(blob)) return true
  return /ad\s*cs|adcs|\besc\d+\b/i.test(prompt) && /config/.test(blob)
}

function rangeOptions(ranges: AskRangeChoice[]): LuxaiChoiceOption[] {
  return ranges.map((range) => ({
    id: range.id,
    label: range.name && range.name.toLowerCase() !== range.id.toLowerCase() ? `${range.name} (${range.id})` : range.id,
  }))
}

function adcsOptions(): LuxaiChoiceOption[] {
  return ADCS_CONFIGURATIONS.map((item) => ({
    id: item.id,
    label: `${item.id} — ${item.detail}`,
  }))
}

function preferRanges(ranges: AskRangeChoice[], userText: string): AskRangeChoice[] {
  const index = ranges.findIndex((range) => textMentions(userText, range.id) || textMentions(userText, range.name))
  if (index <= 0) return ranges
  const next = ranges.slice()
  const [hit] = next.splice(index, 1)
  next.unshift(hit)
  return next
}

function prefer(options: LuxaiChoiceOption[], match: (option: LuxaiChoiceOption) => boolean): LuxaiChoiceOption[] {
  const index = options.findIndex(match)
  if (index <= 0) return options
  const next = options.slice()
  const [hit] = next.splice(index, 1)
  next.unshift(hit)
  return next
}

function textMentions(text: string, value: string): boolean {
  const needle = value.trim()
  if (needle.length < 2) return false
  return new RegExp(`(?:^|[^A-Za-z0-9_-])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[^A-Za-z0-9_-]|$)`, "i").test(text)
}
