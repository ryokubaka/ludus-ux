"use client"

import { useState } from "react"
import {
  CheckCircle2,
  Loader2,
  Package,
  PackageX,
  Play,
  RotateCcw,
  Trash2,
  BookOpen,
  Download,
} from "lucide-react"
import Link from "next/link"
import { useQueryClient } from "@tanstack/react-query"
import { useEffectiveScopeTag } from "@/lib/effective-scope-context"
import { queryKeys } from "@/lib/query-keys"
import {
  extensionAnsibleState,
  extensionMissingAnsibleRoles,
  installGoadDependencies,
  requirementsFromExtensionRoleRefs,
  withInstalling,
  withoutInstalling,
} from "@/lib/goad-dependency-service"
import { findMissingFromInstalled } from "@/lib/ansible-requirements-service"
import { useToast } from "@/hooks/use-toast"
import { tryToastLudusSlowHttpError } from "@/lib/ludus-timeout-ui"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ConfirmBar } from "@/components/ui/confirm-bar"
import { TabsContent } from "@/components/ui/tabs"
import { TemplateChips } from "@/app/goad/[id]/goad-instance/template-chips"
import { checkTemplates } from "@/components/goad/goad-instance-tab-utils"
import { extensionIsProvisionOnly } from "@/lib/goad-catalog-capabilities"
import { cn } from "@/lib/utils"
import type { GoadExtensionDef } from "@/lib/types"
import type { GoadExtensionsTabProps } from "./types"

export function GoadExtensionsTab({
  active,
  instance,
  extMap,
  uninstalledExtensions,
  builtNames,
  allNames,
  provisionOnlyExtensionsSupported,
  isRunning,
  pendingAction,
  commitConfirm,
  cancelConfirm,
  reprovisioningExtension,
  removingExtension,
  onReprovisionExtension,
  onRemoveExtension,
  onInstallExtension,
  ansibleInstalled,
  ansibleInstalledLoading = false,
  onAnsibleInstalledChange,
}: GoadExtensionsTabProps) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const scopeTag = useEffectiveScopeTag()
  const [installingDeps, setInstallingDeps] = useState<ReadonlySet<string>>(new Set())

  const handleInstallExtensionDeps = async (ext: GoadExtensionDef) => {
    if (!ansibleInstalled) return
    // Guard against a second click for the same extension while its install runs.
    if (installingDeps.has(ext.name)) return
    const required = requirementsFromExtensionRoleRefs(ext.requiredRoles ?? [])
    const installedItems = [
      ...[...ansibleInstalled.roles].map((name) => ({
        name,
        type: "role" as const,
        version: "",
      })),
      ...[...ansibleInstalled.collections].map((name) => ({
        name,
        type: "collection" as const,
        version: "",
      })),
    ]
    const missing = findMissingFromInstalled(installedItems, required)
    if (missing.length === 0) return

    setInstallingDeps((cur) => withInstalling(cur, ext.name))
    try {
      const result = await installGoadDependencies(missing)
      await queryClient.invalidateQueries({ queryKey: queryKeys.ansible(scopeTag) })
      await onAnsibleInstalledChange?.()

      if (result.failed.length > 0) {
        toast({
          variant: "destructive",
          title: "Some dependencies failed to install",
          description: result.failed.map((f) => `${f.name}: ${f.error}`).join("; "),
        })
        return
      }

      toast({
        title: "Dependencies installed",
        description: `Required Ansible items for ${ext.name} are ready. You can install the extension now.`,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (
        tryToastLudusSlowHttpError({
          toast,
          error: msg,
          slowTitle: "Slow response from Ludus",
          onSlow: () => void onAnsibleInstalledChange?.(),
        })
      ) {
        return
      }
      toast({ variant: "destructive", title: "Install failed", description: msg })
    } finally {
      setInstallingDeps((cur) => withoutInstalling(cur, ext.name))
    }
  }

  return (
    <TabsContent value="extensions" className="mt-4 flex flex-col min-h-0 flex-1 overflow-y-auto">
      {active ? (
        <div className="space-y-4">
          <Alert>
            <AlertDescription className="text-xs">
              <strong>Install</strong> runs providing + Ansible for a new extension.{" "}
              <strong>Re-provision</strong> re-runs only the Ansible playbook for an already-installed
              extension — use this to re-apply config or fix a failed provisioning without touching
              infrastructure. <strong>Remove</strong> destroys extension VMs in Ludus and drops the extension from
              GOAD workspace metadata. Both require <code className="text-primary">Provide</code> to have run first.
            </AlertDescription>
          </Alert>
          {instance.extensions.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Installed</p>
              <div className="grid gap-2">
                {instance.extensions.map((ext) => {
                  const scopeReprov = `ext-reprovision:${ext}`
                  const scopeRemove = `ext-remove:${ext}`
                  const rowHasPending =
                    pendingAction?.key === scopeReprov || pendingAction?.key === scopeRemove
                  return (
                    <div
                      key={ext}
                      className="rounded-lg border border-status-success/30 bg-green-500/5"
                    >
                      <div className="flex items-center justify-between p-3">
                        <div className="flex items-center gap-3">
                          <CheckCircle2 className="h-4 w-4 text-status-success flex-shrink-0" />
                          <div>
                            <code className="font-mono text-sm text-status-success">{ext}</code>
                            {extMap[ext]?.description && (
                              <p className="text-xs text-muted-foreground">{extMap[ext].description}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-muted-foreground hover:text-foreground"
                            onClick={() => onReprovisionExtension(ext)}
                            disabled={
                              isRunning ||
                              (!!pendingAction && !rowHasPending) ||
                              instance.status === "CREATED" ||
                              removingExtension === ext
                            }
                            title="Re-run Ansible provisioning for this extension (no infrastructure changes)"
                          >
                            {reprovisioningExtension === ext ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RotateCcw className="h-3.5 w-3.5" />
                            )}
                            {reprovisioningExtension === ext ? "Running..." : "Re-provision"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive border-destructive/40 hover:bg-destructive/10"
                            onClick={() => onRemoveExtension(ext)}
                            disabled={
                              isRunning ||
                              (!!pendingAction && !rowHasPending) ||
                              instance.status === "CREATED" ||
                              !instance.ludusRangeId ||
                              reprovisioningExtension === ext ||
                              removingExtension === ext
                            }
                            title={
                              !instance.ludusRangeId
                                ? "Run Provide first — a dedicated Ludus range is required"
                                : "Destroy extension VMs in Ludus and remove from GOAD instance"
                            }
                          >
                            {removingExtension === ext ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                            {removingExtension === ext ? "Removing..." : "Remove"}
                          </Button>
                        </div>
                      </div>
                      <ConfirmBar
                        pending={pendingAction}
                        scope={scopeReprov}
                        onConfirm={commitConfirm}
                        onCancel={cancelConfirm}
                        className="mx-3 mb-3"
                      />
                      <ConfirmBar
                        pending={pendingAction}
                        scope={scopeRemove}
                        onConfirm={commitConfirm}
                        onCancel={cancelConfirm}
                        className="mx-3 mb-3"
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {uninstalledExtensions.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Available to Install</p>
              <p className="text-[11px] text-muted-foreground mb-3">
                Install adds new VMs and runs Ansible. Re-provision re-runs Ansible only. Remove destroys extension VMs.
              </p>
              <div className="grid gap-2">
                {uninstalledExtensions.map((ext) => {
                  const tpl = checkTemplates(ext.requiredTemplates ?? [], builtNames, allNames)
                  const templatesReady = tpl.ready || (ext.requiredTemplates ?? []).length === 0
                  const ansibleState = extensionAnsibleState(
                    ext,
                    ansibleInstalled ?? null,
                    ansibleInstalledLoading,
                  )
                  const ansibleReady = ansibleState === "ready"
                  const ansibleUnknown = ansibleState === "unknown"
                  const missingAnsible = extensionMissingAnsibleRoles(ext, ansibleInstalled ?? null)
                  const noNewVms = extensionIsProvisionOnly(ext)
                  const skipDeploy = noNewVms && provisionOnlyExtensionsSupported
                  const canInstall =
                    templatesReady &&
                    ansibleReady &&
                    !ansibleInstalledLoading &&
                    !!instance.ludusRangeId &&
                    instance.status !== "CREATED" &&
                    !isRunning
                  const scopeInstall = `ext-install:${ext.name}`
                  const installing = installingDeps.has(ext.name)
                  return (
                    <div
                      key={ext.name}
                      className={cn(
                        "rounded-lg border",
                        !templatesReady || ansibleState === "missing"
                          ? "border-border opacity-70"
                          : "border-border hover:border-primary/30",
                      )}
                    >
                      <div className="flex items-start justify-between p-3 gap-3">
                        <div className="flex items-start gap-3 min-w-0 flex-1">
                          <Package className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <code className="font-mono text-sm">{ext.name}</code>
                              {ext.machines.length > 0 && (
                                <span className="text-xs text-muted-foreground">
                                  +{ext.machines.length} VM{ext.machines.length !== 1 ? "s" : ""}
                                </span>
                              )}
                              {!templatesReady && (
                                <Badge variant="destructive" className="text-xs gap-1">
                                  <PackageX className="h-2.5 w-2.5" /> Missing templates
                                </Badge>
                              )}
                              {templatesReady && ansibleState === "missing" && (
                                <Badge variant="destructive" className="text-xs gap-1">
                                  <BookOpen className="h-2.5 w-2.5" /> Missing Ansible
                                </Badge>
                              )}
                              {templatesReady && ansibleUnknown && (
                                <Badge variant="outline" className="text-xs gap-1">
                                  <Loader2 className="h-2.5 w-2.5 animate-spin" /> Checking Ansible…
                                </Badge>
                              )}
                            </div>
                            {ext.description && (
                              <p className="text-xs text-muted-foreground mt-0.5">{ext.description}</p>
                            )}
                            {(ext.requiredTemplates ?? []).length > 0 && (
                              <TemplateChips
                                required={ext.requiredTemplates}
                                builtNames={builtNames}
                                allNames={allNames}
                              />
                            )}
                            {missingAnsible.length > 0 && (
                              <p className="text-[10px] text-muted-foreground mt-1 font-mono">
                                Requires: {missingAnsible.join(", ")}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2 flex-shrink-0">
                          {missingAnsible.length > 0 && (
                            <Button
                              size="sm"
                              variant="secondary"
                              className="gap-1.5 h-8"
                              disabled={installing || isRunning || ansibleInstalledLoading}
                              onClick={() => void handleInstallExtensionDeps(ext)}
                            >
                              {installing ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Download className="h-3.5 w-3.5" />
                              )}
                              {installing ? "Installing…" : "Install dependencies"}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5 h-8"
                            onClick={() => onInstallExtension(ext.name)}
                            disabled={!canInstall}
                            title={
                              instance.status === "CREATED"
                                ? "Run Provide before installing extensions"
                                : !instance.ludusRangeId
                                  ? "Run Provide first — a dedicated Ludus range is required"
                                  : !templatesReady
                                    ? `Missing Ludus templates: ${[...tpl.missingAbsent, ...tpl.missingUnbuilt].join(", ")}`
                                    : ansibleUnknown
                                      ? "Checking Ansible dependencies…"
                                      : ansibleState === "missing"
                                        ? `Missing Ansible: ${missingAnsible.join(", ")} — install dependencies first`
                                        : isRunning
                                        ? "Wait for current action to finish"
                                        : skipDeploy
                                          ? "Enable extension and run Ansible only (no Ludus deploy)"
                                          : noNewVms
                                            ? "Install — GOAD on this server may still run Ludus range deploy"
                                            : "Install this extension"
                            }
                          >
                            <Play className="h-3.5 w-3.5" />
                            {skipDeploy ? "Provision" : "Install"}
                          </Button>
                          {missingAnsible.length > 0 && (
                            <Link
                              href="/ansible"
                              className="text-[10px] text-primary underline underline-offset-2"
                            >
                              Ansible page
                            </Link>
                          )}
                        </div>
                      </div>
                      <ConfirmBar
                        pending={pendingAction}
                        scope={scopeInstall}
                        onConfirm={commitConfirm}
                        onCancel={cancelConfirm}
                        className="mx-3 mb-3"
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {instance.extensions.length === 0 && uninstalledExtensions.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">
              No extensions available for this lab
            </p>
          )}
        </div>
      ) : null}
    </TabsContent>
  )
}
