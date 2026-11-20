"use client"

import {
  hostnameIncludesRangeId,
  RANGE_ID_HOSTNAME_NOTE,
  yamlHostnamesIncludeRangeId,
} from "@/lib/range/hostname-range-id"

export function RangeIdHostnameNote({ value }: { value: string }) {
  if (!hostnameIncludesRangeId(value)) return null
  return <p className="text-[10px] text-muted-foreground">{RANGE_ID_HOSTNAME_NOTE}</p>
}

export function RangeIdYamlHostnameNote({ yaml }: { yaml: string }) {
  if (!yamlHostnamesIncludeRangeId(yaml)) return null
  return <p className="mb-2 text-xs text-muted-foreground">{RANGE_ID_HOSTNAME_NOTE}</p>
}
