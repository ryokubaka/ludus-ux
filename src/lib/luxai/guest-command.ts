import yaml from "js-yaml"
import { inferOS } from "@/lib/range/range-vm-wizard"

export type GuestOs = "windows" | "posix" | "unknown"
export type GuestShell = "posix" | "powershell"

export interface FittedGuestCommand {
  os: GuestOs
  shell: GuestShell
  command: string
  /** Why the model's command was changed. Empty when the proposal is unchanged. */
  note: string | null
}

const PROCESS_TABLE = "Get-Process | Format-Table Name, Id -AutoSize"
const POSIX_PROCESSES = "ps -eo pid,comm"
const SAFE_TOKEN = /^[A-Za-z0-9_.*?*-]+$/
const SAFE_PATH = /^[A-Za-z0-9_./:\\-]+$/

/** Programs that are not PowerShell commands or aliases. */
const UNIX_ONLY = new Set([
  "grep", "egrep", "fgrep", "awk", "sed", "chmod", "chown", "chgrp", "sudo",
  "apt", "apt-get", "yum", "dnf", "pacman", "systemctl", "journalctl", "service",
  "ss", "ifconfig", "bash", "sh", "zsh", "htop", "top", "killall", "pgrep", "pkill",
  "crontab", "nohup", "lsblk", "lsof", "find", "which", "whereis", "head", "tail",
  "wc", "uniq", "xargs", "tar", "gzip", "gunzip", "df", "free", "uname", "ip",
  "vi", "vim", "nano", "less", "watch",
])

const INTERACTIVE = new Set(["vi", "vim", "nano", "less", "watch", "htop", "top"])
const UNIX_PS_ARG = /^(aux|auxww|-ef|-e|-f|-A|-a|-ax|-aux|-u|-x|-ww|--forest)$/i

function unixPs(command: string): boolean {
  return flat(command).split(" ").slice(1).some((arg) => UNIX_PS_ARG.test(arg))
}

/** `ps` followed only by UNIX listing flags, such as `ps aux` or `ps -ef`. */
function unixPsListing(text: string): boolean {
  const parts = text.split(" ")
  if (parts.length < 2 || parts[0].toLowerCase() !== "ps") return false
  return parts.slice(1).every((part) => UNIX_PS_ARG.test(part))
}

function flat(command: string): string {
  return command.trim().replace(/\s+/g, " ")
}

function firstWord(command: string): string {
  return flat(command).split(" ")[0]?.toLowerCase() ?? ""
}

function sameHost(candidate: string, host: string, rangeId: string): boolean {
  const raw = candidate.trim().toLowerCase()
  const want = host.trim().toLowerCase()
  if (!raw || !want) return false
  const expanded = raw.replace(/\{\{\s*range_id\s*\}\}/gi, rangeId.trim().toLowerCase())
  if (want === raw || want === expanded) return true
  return want.endsWith(`-${expanded}`) || want.endsWith(`-${raw}`) || expanded.endsWith(`-${want}`) || raw.endsWith(`-${want}`)
}

function templateOs(template: string): GuestOs | null {
  const name = template.trim()
  if (!name) return null
  if (/macos|osx|darwin/i.test(name)) return "posix"
  return inferOS(name).isWindows ? "windows" : "posix"
}

/** Windows or Linux from the range config and the Ansible inventory. Unknown when neither says. */
export function guestOsForHost(rangeId: string, host: string, configYaml: string, inventory: string): GuestOs {
  return inventoryOs(inventory, host) ?? configOs(rangeId, host, configYaml) ?? "unknown"
}

function configOs(rangeId: string, host: string, configYaml: string): GuestOs | null {
  if (!configYaml.trim()) return null
  let doc: unknown
  try {
    doc = yaml.load(configYaml)
  } catch {
    return null
  }
  const ludus = (doc as { ludus?: unknown } | null)?.ludus
  if (!Array.isArray(ludus)) return null
  for (const entry of ludus) {
    if (!entry || typeof entry !== "object") continue
    const vm = entry as Record<string, unknown>
    const names = [vm.vm_name, vm.hostname, vm.vmName].filter((value): value is string => typeof value === "string")
    if (!names.some((name) => sameHost(name, host, rangeId))) continue
    const windows = vm.windows && typeof vm.windows === "object"
    const linux = vm.linux === true || (vm.linux && typeof vm.linux === "object")
    if (windows && !linux) return "windows"
    if (linux && !windows) return "posix"
    const fromTemplate = typeof vm.template === "string" ? templateOs(vm.template) : null
    if (fromTemplate) return fromTemplate
  }
  return null
}

function inventoryOs(inventory: string, host: string): GuestOs | null {
  if (!inventory.trim()) return null
  let section = ""
  const windows = new Set<string>()
  const posix = new Set<string>()
  const groupOs = new Map<string, GuestOs>()
  for (const raw of inventory.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith("#") || line.startsWith(";")) continue
    const header = /^\[([^\]]+)\]$/.exec(line)
    if (header) {
      section = header[1].toLowerCase()
      continue
    }
    if (section.endsWith(":vars")) {
      const group = section.slice(0, -":vars".length)
      if (/ansible_connection\s*[=:]\s*winrm\b/i.test(line)) groupOs.set(group, "windows")
      if (/ansible_connection\s*[=:]\s*ssh\b/i.test(line)) groupOs.set(group, "posix")
      continue
    }
    if (section.endsWith(":children")) continue
    const name = line.split(/\s+/)[0] ?? ""
    if (!name || name.includes("=")) continue
    if (/ansible_connection\s*[=:]\s*winrm\b/i.test(line)) windows.add(name.toLowerCase())
    else if (/ansible_connection\s*[=:]\s*ssh\b/i.test(line)) posix.add(name.toLowerCase())
    else if (groupOs.get(section) === "windows" || /(^|:)windows($|:)/.test(section)) windows.add(name.toLowerCase())
    else if (groupOs.get(section) === "posix" || /(^|:)(linux|debian|ubuntu|kali)($|:)/.test(section)) posix.add(name.toLowerCase())
  }
  const matched = (group: Set<string>) => [...group].some((name) => sameHost(name, host, ""))
  if (matched(windows) && !matched(posix)) return "windows"
  if (matched(posix) && !matched(windows)) return "posix"
  return null
}

function shellFor(os: GuestOs, requested: GuestShell): GuestShell {
  if (os === "windows") return "powershell"
  if (os === "posix") return "posix"
  return requested
}

function processName(token: string): string | null {
  const name = token.replace(/^['"]|['"]$/g, "")
  return SAFE_TOKEN.test(name) ? name : null
}

function processTable(name: string | null): string {
  if (!name) return PROCESS_TABLE
  return `Get-Process -Name ${name} | Format-Table Name, Id -AutoSize`
}

/** Read-only commands a small model emits, written for the shell that will run them. */
function rewritten(shell: GuestShell, command: string): string | null {
  const text = flat(command)
  if (shell === "powershell") {
    if (/^Get-Process\s*\|\s*Format-Table\s+Name,\s*Id\s+-AutoSize$/i.test(text)) return text
    if (/^Get-Process$/i.test(text) || /^(ps|tasklist)$/i.test(text)) return PROCESS_TABLE
    if (unixPsListing(text)) return PROCESS_TABLE
    const named = /^(?:ps|Get-Process)\s+(?:-Name\s+)?([A-Za-z0-9_.*?*-]+)$/i.exec(text)
    if (named && !/^(aux|auxww)$/i.test(named[1])) {
      const name = processName(named[1])
      if (name) return processTable(name)
    }
    const grepped = /^ps(?:\s+aux)?\s*\|\s*(?:grep|findstr)\s+(\S+)$/i.exec(text)
    if (grepped) {
      const name = processName(grepped[1])
      if (name) return `Get-Process | Where-Object { $_.ProcessName -like '*${name}*' } | Format-Table Name, Id -AutoSize`
    }
    if (/^(top|htop)$/i.test(text)) {
      return "Get-Process | Sort-Object CPU -Descending | Select-Object -First 20 Name, Id, CPU | Format-Table -AutoSize"
    }
    if (/^(ls|dir)(\s+-[lah1]+)?$/i.test(text)) return "Get-ChildItem | Format-Table Mode, Length, Name -AutoSize"
    const listed = /^(?:ls|dir)\s+-[lah1]+\s+(\S+)$/i.exec(text)
    if (listed && SAFE_PATH.test(listed[1])) {
      return `Get-ChildItem -Path '${listed[1]}' | Format-Table Mode, Length, Name -AutoSize`
    }
    if (/^(ip\s+addr|ip\s+a|ip\s+address|ifconfig)(\s+-a)?$/i.test(text)) {
      return "Get-NetIPAddress | Where-Object { $_.AddressFamily -eq 'IPv4' } | Format-Table InterfaceAlias, IPAddress -AutoSize"
    }
    if (/^(netstat(\s+-anp?)?|ss(\s+-lntpu?)?)$/i.test(text)) {
      return "Get-NetTCPConnection | Select-Object -First 40 LocalAddress, LocalPort, State | Format-Table -AutoSize"
    }
    if (/^df(\s+-h)?$/i.test(text)) return "Get-PSDrive -PSProvider FileSystem | Format-Table Name, Used, Free -AutoSize"
    if (/^free(\s+-h)?$/i.test(text)) {
      return "Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize, FreePhysicalMemory | Format-List"
    }
    if (/^uname(\s+-a)?$/i.test(text)) return "Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version | Format-List"
    const service = /^systemctl\s+status\s+([A-Za-z0-9_.:@-]+)$/i.exec(text)
    if (service) return `Get-Service ${service[1]} | Format-List`
    const grepping = /^grep\s+(\S+)\s+(\S+)$/i.exec(text)
    if (grepping) {
      const pattern = processName(grepping[1])
      if (pattern && SAFE_PATH.test(grepping[2])) return `Select-String -Path '${grepping[2]}' -Pattern '${pattern}'`
    }
    return null
  }
  if (/^ps\b/i.test(text) && !/^Get-Process\b/i.test(text)) return text
  if (/^Get-Process\b/i.test(text) || /^tasklist$/i.test(text) || /^(top|htop)$/i.test(text)) {
    const named = /^(?:Get-Process)\s+(?:-Name\s+)?([A-Za-z0-9_.*?*-]+)/i.exec(text)
    const name = named ? processName(named[1]) : null
    return name ? `ps -C ${name}` : POSIX_PROCESSES
  }
  if (/^Get-ChildItem\b/i.test(text) || /^dir$/i.test(text)) return "ls -la"
  if (/^Get-NetIPAddress\b/i.test(text) || /^ipconfig\b/i.test(text)) return "ip -4 addr"
  if (/^Get-NetTCPConnection\b/i.test(text) || /^netstat\b/i.test(text)) return "ss -lnt"
  if (/^Get-PSDrive\b/i.test(text)) return "df -h"
  if (/^Get-CimInstance\s+Win32_OperatingSystem\b/i.test(text)) return "uname -a"
  const service = /^Get-Service\s+([A-Za-z0-9_.:@-]+)/i.exec(text)
  if (service) return `systemctl status ${service[1]} --no-pager`
  if (/^Select-String\b/i.test(text)) return null
  return null
}

function refuse(shell: GuestShell, command: string): string | null {
  const text = flat(command)
  const word = firstWord(text)
  if (!word) return "Command is empty."
  if (shell === "powershell") {
    if (INTERACTIVE.has(word) || UNIX_ONLY.has(word)) {
      return `\`${text}\` does not run in PowerShell. This host uses win_shell. For processes, propose: ${PROCESS_TABLE}`
    }
    if (unixPs(text)) {
      return `\`ps aux\` does not run in PowerShell. ps is Get-Process, and aux is read as a process name. Propose: ${PROCESS_TABLE}`
    }
    return null
  }
  if (INTERACTIVE.has(word)) {
    return `\`${word}\` waits for a terminal. A guest command has no terminal. For processes, propose: ${POSIX_PROCESSES}`
  }
  if (/^[A-Za-z]+-[A-Za-z]/.test(word)) {
    return `\`${word}\` does not run in a POSIX shell. For processes, propose: ${POSIX_PROCESSES}`
  }
  return null
}

/**
 * Pick the shell the host actually runs, and replace a command that would fail there.
 * A small model can say `ps aux`. On Windows that becomes the PowerShell process table.
 */
export function fitGuestCommand(os: GuestOs, requested: GuestShell, command: string): FittedGuestCommand {
  const shell = shellFor(os, requested)
  const original = command.trim()
  if (!original) throw new Error("Command is empty.")
  const next = rewritten(shell, original)
  if (next && flat(next) !== flat(original)) {
    const host = os === "windows" ? "This host is Windows. " : os === "posix" ? "This host is Linux. " : ""
    const unixFlags = shell === "powershell" && (unixPs(original) || UNIX_ONLY.has(firstWord(original)))
    const cmdletOnPosix = shell === "posix" && /^[A-Za-z]+-[A-Za-z]/.test(firstWord(original))
    const instead = unixFlags || cmdletOnPosix
      ? `\`${flat(original)}\` does not run in ${shell === "powershell" ? "PowerShell" : "a POSIX shell"}. The proposal runs: ${next}`
      : `The proposal runs \`${next}\` instead of \`${flat(original)}\`.`
    return { os, shell, command: next, note: `${host}${instead}` }
  }
  if (/[;&`]/.test(original) || original.includes("\n") || original.includes("$(")) {
    throw new Error(`A guest command is one command. For processes, propose: ${shell === "powershell" ? PROCESS_TABLE : POSIX_PROCESSES}`)
  }
  const why = next ? null : refuse(shell, original)
  if (why) throw new Error(why)
  if (shell !== requested) {
    return {
      os,
      shell,
      command: next ?? original,
      note: shell === "powershell"
        ? "This host is Windows, so the proposal uses PowerShell."
        : "This host is Linux, so the proposal uses a POSIX shell.",
    }
  }
  return { os, shell, command: next ?? original, note: null }
}
