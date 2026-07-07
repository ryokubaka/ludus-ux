import { getSettings } from "./settings-store"

/** GOAD install root on the Ludus host (`GOAD_PATH` / Settings). */
export function resolveGoadPath(): string {
  return getSettings().goadPath.trim()
}

/** Ludus install root on the Ludus host (`LUDUS_INSTALL_PATH` / Settings). */
export function resolveLudusInstallPath(): string {
  return getSettings().ludusInstallPath.trim()
}

/** Ludus range Ansible log on the Ludus host. */
export function ludusRangeAnsibleLogPath(rangeId: string): string {
  const root = resolveLudusInstallPath()
  const safe = rangeId.replace(/[^a-zA-Z0-9_-]/g, "")
  return `${root}/ranges/${safe}/ansible.log`
}
