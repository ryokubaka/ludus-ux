/**
 * Security Onion sniff NIC lifecycle on Proxmox.
 * Source of truth = live qm config + bridge ageing (not LUX SQLite).
 * Host marker under /opt/ludus/lux/so-sniff/ is audit-only.
 */
import { sshExec } from "@/lib/proxmox-ssh"
import { requireProxmoxSsh } from "@/lib/root-ssh-auth"

export const SO_SNIFF_MARKER_DIR = "/opt/ludus/lux/so-sniff"
export const SO_DEFAULT_SNIFF_TAG = 10
/** Linux bridge default ageing (seconds). */
export const SO_BRIDGE_AGEING_DEFAULT_SEC = 300

export type SoSniffCreds = {
  sshHost: string
  sshPort: number
  sshUser: string
  sshPass: string
}

export function rangeBridgeName(rangeNumber: number): string {
  return `vmbr${1000 + rangeNumber}`
}

/** Detect SO labs from Ludus range-config YAML text. */
export function rangeConfigNeedsSoSniff(yaml: string): boolean {
  const text = yaml || ""
  if (/ludus_securityonion\b/.test(text)) return true
  if (/securityonion-[\w.-]*-template/.test(text)) return true
  if (/vm_name:\s*["']?\{\{\s*range_id\s*\}\}["']?-so\b/.test(text)) return true
  if (/hostname:\s*["']?\{\{\s*range_id\s*\}\}["']?-so\b/.test(text)) return true
  return false
}

/** VM names that look like Security Onion sensors in a Ludus range. */
export function isSoVmName(name: string, rangeId?: string): boolean {
  const n = (name || "").trim()
  if (!n) return false
  if (/-so$/i.test(n)) return true
  if (rangeId && n.toLowerCase() === `${rangeId.toLowerCase()}-so`) return true
  if (/securityonion/i.test(n)) return true
  return false
}

export function sniffNetSpec(vmbr: string, sniffTag: number): string {
  return `virtio,bridge=${vmbr},tag=${sniffTag},firewall=0`
}

export function net1LooksLikeSniff(net1Line: string, vmbr: string, sniffTag: number): boolean {
  const line = net1Line.replace(/^net1:\s*/i, "").trim()
  if (!line) return false
  if (!line.includes(`bridge=${vmbr}`)) return false
  if (!new RegExp(`(?:^|,)tag=${sniffTag}(?:\\b|,|$)`).test(line)) return false
  if (/firewall=1/.test(line)) return false
  return true
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

async function withSsh(
  creds: SoSniffCreds | null,
  command: string,
): Promise<{ ok: true; out: string } | { ok: false; error: string }> {
  const c =
    creds ??
    (() => {
      const r = requireProxmoxSsh()
      if (!r.ok) return null
      return r.creds
    })()
  if (!c) {
    return { ok: false, error: "Proxmox root SSH not configured" }
  }
  try {
    const out = await sshExec(c.sshHost, c.sshPort, c.sshUser, c.sshPass, command)
    return { ok: true, out }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function enableSoSniffOnVm(args: {
  vmid: number
  rangeNumber: number
  rangeId: string
  vmName: string
  sniffTag?: number
  creds?: SoSniffCreds | null
}): Promise<{ ok: boolean; detail: string; already?: boolean }> {
  const sniffTag = args.sniffTag ?? SO_DEFAULT_SNIFF_TAG
  const vmbr = rangeBridgeName(args.rangeNumber)
  const netSpec = sniffNetSpec(vmbr, sniffTag)
  const markerPath = `${SO_SNIFF_MARKER_DIR}/${args.rangeId}.json`

  const script = `
set -euo pipefail
VMID=${args.vmid}
VMBR=${shellQuote(vmbr)}
TAG=${sniffTag}
NETSPEC=${shellQuote(netSpec)}
MARKER=${shellQuote(markerPath)}
RANGE_ID=${shellQuote(args.rangeId)}
VM_NAME=${shellQuote(args.vmName)}

if ! qm status "$VMID" >/dev/null 2>&1; then
  echo "VM $VMID not found"
  exit 2
fi

CFG=$(qm config "$VMID")
NET1=$(echo "$CFG" | sed -n 's/^net1: //p' | head -1 || true)

if [ -n "$NET1" ]; then
  case "$NET1" in
    *bridge=$VMBR*tag=$TAG*)
      echo "net1 already sniff-ready"
      ;;
    *)
      echo "net1 already set to unexpected value: $NET1"
      exit 3
      ;;
  esac
else
  qm set "$VMID" -net1 "$NETSPEC"
  echo "added net1=$NETSPEC"
fi

# Hub mode for Ludus packet capture
if command -v brctl >/dev/null 2>&1; then
  brctl setageing "$VMBR" 0 || true
fi
ip link set dev "$VMBR" type bridge ageing_time 0 2>/dev/null || true

mkdir -p ${shellQuote(SO_SNIFF_MARKER_DIR)}
cat > "$MARKER" <<EOF
{"rangeId":"$RANGE_ID","vmid":$VMID,"vmName":"$VM_NAME","vmbr":"$VMBR","sniffTag":$TAG,"updatedAt":"$(date -Iseconds)"}
EOF
echo "marker written $MARKER"
`.trim()

  const res = await withSsh(args.creds ?? null, script)
  if (!res.ok) {
    console.warn(`[so-sniff] enable failed vmid=${args.vmid}: ${res.error}`)
    return { ok: false, detail: res.error }
  }
  const already = /already sniff-ready/.test(res.out)
  console.info(`[so-sniff] enable ok vmid=${args.vmid}${already ? " (noop)" : ""}`)
  return { ok: true, detail: res.out, already }
}

export async function cleanupSoSniffForRange(args: {
  rangeId: string
  rangeNumber?: number
  vmNames?: string[]
  sniffTag?: number
  creds?: SoSniffCreds | null
}): Promise<{ ok: boolean; detail: string }> {
  const sniffTag = args.sniffTag ?? SO_DEFAULT_SNIFF_TAG
  const rangeId = args.rangeId.trim()
  if (!rangeId) return { ok: false, detail: "rangeId required" }

  const vmbrHint =
    typeof args.rangeNumber === "number" && Number.isFinite(args.rangeNumber)
      ? rangeBridgeName(args.rangeNumber)
      : ""

  const namesJson = JSON.stringify(args.vmNames ?? [])
  const script = `
set -euo pipefail
RANGE_ID=${shellQuote(rangeId)}
TAG=${sniffTag}
VMBR_HINT=${shellQuote(vmbrHint)}
MARKER_DIR=${shellQuote(SO_SNIFF_MARKER_DIR)}
MARKER="$MARKER_DIR/$RANGE_ID.json"
AGEING_DEFAULT=${SO_BRIDGE_AGEING_DEFAULT_SEC}
NAMES_JSON=${shellQuote(namesJson)}

VMIDS=""
VMBRS=""

if [ -f "$MARKER" ]; then
  MID=$(sed -n 's/.*"vmid"[[:space:]]*:[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p' "$MARKER" | head -1 || true)
  MBR=$(sed -n 's/.*"vmbr"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' "$MARKER" | head -1 || true)
  if [ -n "$MID" ]; then VMIDS="$VMIDS $MID"; fi
  if [ -n "$MBR" ]; then VMBRS="$VMBRS $MBR"; fi
fi

# Discover by name: qm list full
while IFS= read -r line; do
  [ -z "$line" ] && continue
  ID=$(echo "$line" | awk '{print $1}')
  NAME=$(echo "$line" | awk '{print $2}')
  case "$NAME" in
    "$RANGE_ID"-so|*-so|*securityonion*)
      VMIDS="$VMIDS $ID"
      ;;
  esac
  # also match explicit names from LUX
  echo "$NAMES_JSON" | grep -Fq "\"$NAME\"" && VMIDS="$VMIDS $ID" || true
done < <(qm list 2>/dev/null | awk 'NR>1 {print $1" "$2}' || true)

if [ -n "$VMBR_HINT" ]; then
  VMBRS="$VMBRS $VMBR_HINT"
fi

# Unique VMIDs
VMIDS=$(echo "$VMIDS" | tr ' ' '\\n' | sed '/^$/d' | sort -u | tr '\\n' ' ')

for VMID in $VMIDS; do
  [ -z "$VMID" ] && continue
  if ! qm status "$VMID" >/dev/null 2>&1; then
    continue
  fi
  CFG=$(qm config "$VMID" 2>/dev/null || true)
  NET1=$(echo "$CFG" | sed -n 's/^net1: //p' | head -1 || true)
  if [ -z "$NET1" ]; then
    continue
  fi
  BR=$(echo "$NET1" | sed -n 's/.*bridge=\\([^,]*\\).*/\\1/p')
  case "$NET1" in
    *tag=$TAG*)
      qm set "$VMID" -delete net1 || true
      echo "deleted net1 on $VMID"
      if [ -n "$BR" ]; then VMBRS="$VMBRS $BR"; fi
      ;;
  esac
done

VMBRS=$(echo "$VMBRS" | tr ' ' '\\n' | sed '/^$/d' | sort -u | tr '\\n' ' ')

for VMBR in $VMBRS; do
  [ -z "$VMBR" ] && continue
  # Remaining sniff NICs on this bridge?
  REMAIN=0
  while IFS= read -r cfgfile; do
    [ -z "$cfgfile" ] && continue
    if grep -E "^net[0-9]+:" "$cfgfile" 2>/dev/null | grep -F "bridge=$VMBR" | grep -E "tag=$TAG" >/dev/null 2>&1; then
      REMAIN=1
      break
    fi
  done < <(ls /etc/pve/qemu-server/*.conf 2>/dev/null || true)

  if [ "$REMAIN" = "0" ]; then
    if command -v brctl >/dev/null 2>&1; then
      brctl setageing "$VMBR" "$AGEING_DEFAULT" || true
    fi
    ip link set dev "$VMBR" type bridge ageing_time $((AGEING_DEFAULT * 100)) 2>/dev/null || true
    rm -f "/etc/network/interfaces.d/lux-so-sniff-$VMBR" 2>/dev/null || true
    echo "restored ageing on $VMBR"
  else
    echo "sniff NICs remain on $VMBR; leaving ageing"
  fi
done

rm -f "$MARKER" 2>/dev/null || true
echo "cleanup complete for $RANGE_ID"
`.trim()

  const res = await withSsh(args.creds ?? null, script)
  if (!res.ok) {
    console.warn(`[so-sniff] cleanup failed range=${rangeId}: ${res.error}`)
    return { ok: false, detail: res.error }
  }
  console.info(`[so-sniff] cleanup ok range=${rangeId}`)
  return { ok: true, detail: res.out }
}
