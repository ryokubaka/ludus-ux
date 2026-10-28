import { isLudusTemplateDeleteRefused } from "@/lib/template-packer-paths"

export type TemplateDeleteErrorCode =
  | "TEMPLATE_IN_USE_BY_VMS"
  | "TEMPLATE_INCLUDED"
  | "TEMPLATE_DELETE_FAILED"

export interface TemplateDeleteErrorPayload {
  error: string
  code: TemplateDeleteErrorCode
  templateName: string
  actionUrl?: string
  blockingVmCount?: number
}

export interface ClassifyTemplateDeleteFailureInput {
  templateName: string
  apiMessage?: string
  sshOut?: string
  apiRefused?: boolean
  stillListed?: boolean
}

/** Proxmox refuses template removal when linked clones still exist. */
export function isTemplateBlockedByLinkedClones(text: string): boolean {
  return /still in use by linked clone/i.test(text)
}

/** Optional template VMID from Proxmox volume path (e.g. ludus:110/base-110-disk-0.qcow2). */
export function extractTemplateVmidFromBlockerText(text: string): number | undefined {
  const m = text.match(/ludus:(\d+)\//i)
  if (!m) return undefined
  const id = Number(m[1])
  return Number.isFinite(id) ? id : undefined
}

function combinedDiagnosticText(input: ClassifyTemplateDeleteFailureInput): string {
  return [input.apiMessage, input.sshOut].filter(Boolean).join("\n")
}

function vmManagementActionUrl(templateName: string): string {
  return `/admin?tab=vms&template=${encodeURIComponent(templateName)}`
}

export function classifyTemplateDeleteFailure(
  input: ClassifyTemplateDeleteFailureInput,
): TemplateDeleteErrorPayload {
  const { templateName } = input
  const diagnostic = combinedDiagnosticText(input)
  const linkedCloneBlock = isTemplateBlockedByLinkedClones(diagnostic)
  const includedRefuse =
    Boolean(input.apiRefused) || isLudusTemplateDeleteRefused(input.apiMessage || "")

  if (linkedCloneBlock || (input.stillListed && !includedRefuse)) {
    return {
      code: "TEMPLATE_IN_USE_BY_VMS",
      templateName,
      actionUrl: vmManagementActionUrl(templateName),
      error:
        `Cannot delete "${templateName}" — one or more range VMs are still cloned from it. ` +
        "Remove those VMs first, then retry.",
    }
  }

  if (includedRefuse) {
    return {
      code: "TEMPLATE_INCLUDED",
      templateName,
      error:
        `Ludus refused to delete "${templateName}" because it is a built-in included template. ` +
        "Stock Ludus templates cannot be removed.",
    }
  }

  if (input.stillListed) {
    return {
      code: "TEMPLATE_DELETE_FAILED",
      templateName,
      error:
        `Template "${templateName}" could not be fully removed. ` +
        "Check Ludus logs or retry after clearing any blocking VMs.",
    }
  }

  return {
    code: "TEMPLATE_DELETE_FAILED",
    templateName,
    error: `Failed to delete template "${templateName}".`,
  }
}

export function httpStatusForTemplateDeleteError(code: TemplateDeleteErrorCode): number {
  if (code === "TEMPLATE_IN_USE_BY_VMS") return 409
  return 502
}
