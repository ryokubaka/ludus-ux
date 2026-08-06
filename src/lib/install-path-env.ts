/**
 * Lazy env reads for GOAD / Ludus / LudusHound install roots (settings-store default layer).
 * Do not read at module load — call these functions at runtime / in tests.
 */
export function goadPathFromEnv(): string {
  return process.env.GOAD_PATH || "/opt/GOAD"
}

export function ludusInstallPathFromEnv(): string {
  return process.env.LUDUS_INSTALL_PATH || "/opt/ludus"
}

export function ludushoundPathFromEnv(): string {
  return process.env.LUDUSHOUND_PATH || "/opt/LudusHound"
}
