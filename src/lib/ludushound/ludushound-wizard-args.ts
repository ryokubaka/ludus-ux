/**
 * Single source for LudusHound CLI argv (wizard + API).
 * Upstream: https://github.com/bagelByt3s/LudusHound
 */

export type LudushoundMode = "full" | "attackpath"

export type LudushoundBloodhoundSource = "external" | "filesmap" | "none"

export interface LudushoundFullNeo4jArgs {
  mode: "full"
  source: "external"
  server: string
  user: string
  pass: string
  aliveComputers: string[]
  output: string
  localRoles?: boolean
}

export interface LudushoundFullFilesMapArgs {
  mode: "full"
  source: "filesmap"
  filesMapJson: string
  aliveComputers: string[]
  output: string
  localRoles?: boolean
}

export interface LudushoundAttackPathArgs {
  mode: "attackpath"
  attackPath: string
  domainController: string
  output: string
  localRoles?: boolean
}

export type LudushoundGenerateArgs =
  | LudushoundFullNeo4jArgs
  | LudushoundFullFilesMapArgs
  | LudushoundAttackPathArgs

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** Validate inputs before SSH; returns error message or null. */
export function validateLudushoundArgs(args: LudushoundGenerateArgs): string | null {
  if (!args.output?.trim()) return "Output path is required"
  if (args.localRoles != null && typeof args.localRoles !== "boolean") {
    return "localRoles must be a boolean"
  }

  if (args.mode === "attackpath") {
    if (!args.attackPath?.trim()) return "AttackPath JSON path is required"
    if (!args.domainController?.trim()) return "DomainController FQDN is required"
    if (!args.domainController.includes(".")) {
      return "DomainController must be an FQDN (e.g. DC01.GHOST.LOCAL)"
    }
    return null
  }

  if (!args.aliveComputers?.length) {
    return "At least one AliveComputer FQDN is required"
  }
  for (const fqdn of args.aliveComputers) {
    if (!fqdn.trim() || !fqdn.includes(".")) {
      return `Invalid AliveComputer FQDN: ${fqdn || "(empty)"}`
    }
  }

  if (args.source === "filesmap") {
    if (!args.filesMapJson?.trim()) return "FilesMapJson path is required"
    return null
  }

  if (!args.server?.trim()) return "BloodHound / Neo4j server host is required"
  if (!args.user?.trim()) return "Neo4j user is required"
  if (!args.pass) return "Neo4j password is required"
  return null
}

/** Build argv after the binary path (no binary itself). */
export function buildLudushoundArgv(args: LudushoundGenerateArgs): string[] {
  const err = validateLudushoundArgs(args)
  if (err) throw new Error(err)

  const flags: string[] = []
  if (args.localRoles) flags.push("-LocalRoles")

  if (args.mode === "attackpath") {
    return [
      ...flags,
      "-AttackPath",
      args.attackPath,
      "-DomainController",
      args.domainController,
      "-Output",
      args.output,
    ]
  }

  if (args.source === "filesmap") {
    return [
      ...flags,
      "-FilesMapJson",
      args.filesMapJson,
      "-AliveComputers",
      args.aliveComputers.join(","),
      "-Output",
      args.output,
    ]
  }

  return [
    ...flags,
    "-Server",
    args.server,
    "-User",
    args.user,
    "-Pass",
    args.pass,
    "-AliveComputers",
    args.aliveComputers.join(","),
    "-Output",
    args.output,
  ]
}

/** Full remote command: `cd <root> && ./LudusHound …` */
export function buildLudushoundCommand(binaryDir: string, args: LudushoundGenerateArgs): string {
  const argv = buildLudushoundArgv(args)
  const bin = `${binaryDir.replace(/\/+$/, "")}/LudusHound`
  const parts = [shellQuote(bin), ...argv.map(shellQuote)]
  return `cd ${shellQuote(binaryDir)} && ${parts.join(" ")}`
}

export const LUDUSHOUND_COLLECTION_NAME = "bagelByt3s.ludushound"
export const LUDUSHOUND_COLLECTION_TARBALL = "bagelByt3s-ludushound-1.0.0.tar.gz"
/** Upstream clone URL (official bagelByt3s repo). */
export const LUDUSHOUND_GIT_URL = "https://github.com/bagelByt3s/LudusHound.git"
/** Official Go toolchain version installed on Ludus host when missing (linux). */
export const LUDUSHOUND_GO_VERSION = "1.24.5"
export const DEFAULT_NEO4J_USER = "neo4j"
export const DEFAULT_NEO4J_PASS = "bloodhoundcommunityedition"
