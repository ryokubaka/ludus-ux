import type { LuxaiChoice, LuxaiChoiceField, LuxaiChoiceOption } from "@/lib/luxai/types"

export const LUXAI_FORM_MARKER = "[[luxai-form]]"

export interface SavedLuxaiForm {
  prompt: string
  fields: LuxaiChoiceField[]
  options: LuxaiChoiceOption[]
  selected: string[]
  values: Record<string, string>
}

export function formRecord(choice: LuxaiChoice, selected: string[], values: Record<string, string>): string {
  const saved: SavedLuxaiForm = {
    prompt: choice.prompt,
    fields: choice.fields ?? [],
    options: choice.options ?? [],
    selected,
    values,
  }
  return `${LUXAI_FORM_MARKER}\n${JSON.stringify(saved)}`
}

export function parseFormRecord(text: string): SavedLuxaiForm | null {
  const body = text.trimStart()
  if (!body.startsWith(LUXAI_FORM_MARKER)) return null
  try {
    const parsed = JSON.parse(body.slice(LUXAI_FORM_MARKER.length).trim()) as SavedLuxaiForm
    if (!parsed || typeof parsed.prompt !== "string" || !Array.isArray(parsed.fields)) return null
    return {
      prompt: parsed.prompt,
      fields: parsed.fields,
      options: Array.isArray(parsed.options) ? parsed.options : [],
      selected: Array.isArray(parsed.selected) ? parsed.selected.filter((item) => typeof item === "string") : [],
      values: parsed.values && typeof parsed.values === "object" ? parsed.values : {},
    }
  } catch {
    return null
  }
}
