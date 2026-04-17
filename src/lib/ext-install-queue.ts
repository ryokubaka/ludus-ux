/** Same-tab + cross-tab signal for multi-extension cart installs (dashboard reads this). */
export const LUX_EXT_INSTALL_QUEUE_EVENT = "lux-ext-install-queue-changed" as const

export function luxExtInstallQueueStorageKey(rangeId: string): string {
  return `lux-ext-install-queue:${rangeId}`
}

export type LuxExtInstallQueuePayload = {
  names: string[]
  startedAt: number
  current?: string
  index?: number
  total?: number
}
