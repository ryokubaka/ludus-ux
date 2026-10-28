export interface SarifResult {
  ruleId?: string
  locations?: Array<{
    physicalLocation?: {
      artifactLocation?: { uri?: string; index?: number }
      region?: { startLine?: number }
    }
  }>
}

export interface SarifDocument {
  runs?: Array<{
    results?: SarifResult[]
    artifacts?: Array<{ location?: { uri?: string } }>
  }>
}

export function codeqlIdsInText(text: string): string[]
export function idsCoveringLine(lines: string[], startLine: number): Set<string>
export function filterSarif(doc: SarifDocument, readText: (uri: string) => string | null): number
