/**
 * Static Ludus /api/v2 operation catalog for assistant tools.
 * Merged with live GET /openapi so incomplete server specs still expose
 * power/snapshots/testing/groups/etc. used by LUX (`src/lib/api.ts`).
 */
import type { OpenApiOperation } from "./openapi-tools"

function op(
  operationId: string,
  method: OpenApiOperation["method"],
  path: string,
  summary: string,
  callHints?: string,
  tags?: string[],
): OpenApiOperation {
  const destructive =
    method === "delete" ||
    (method !== "get" &&
      /deploy|destroy|delete|power|testing|abort|purge|force|remove|wipe|clear|reboot|credentials|assign/i.test(
        `${path} ${operationId}`,
      )) ||
    (method === "post" && /^\/templates(\/abort)?$/.test(path))
  return {
    operationId,
    method,
    path,
    summary,
    destructive,
    tags: tags ?? ["ludus-catalog"],
    callHints,
  }
}

/** Canonical Ludus v2 ops mirrored from api-docs + LUX client. */
export const LUDUS_OPS_CATALOG: OpenApiOperation[] = [
  op("getVersion", "get", "/", "Ludus server version"),

  // Users
  op("listUsers", "get", "/user", "Current / list users for API key"),
  op("listAllUsers", "get", "/user/all", "All users (admin)"),
  op("addUser", "post", "/user", "Create user (admin)", "body: userID, name?, isAdmin?, email?"),
  op("deleteUser", "delete", "/user/{userID}", "Delete user (admin)", "query: deleteDefaultRange?; pathParams.userID"),
  op("getUserApikey", "get", "/user/apikey", "Fetch user API key (admin)", "query: userID*"),
  op("setUserCredentials", "post", "/user/credentials", "Set Proxmox/Ludus password", "body: userID, proxmoxPassword"),
  op("getUserWireguard", "get", "/user/wireguard", "WireGuard config for current user"),

  // Ranges
  op("getRange", "get", "/range", "Range status + VMs", "query: rangeID*"),
  op("listAllRanges", "get", "/range/all", "All ranges (admin)"),
  op("listAccessibleRanges", "get", "/ranges/accessible", "Ranges accessible to current user"),
  op("deleteRange", "delete", "/range", "Delete range (force)", "query: rangeID*, force=true; or userID+force"),
  op("deleteRangeVMs", "delete", "/range/{rangeID}/vms", "Destroy all VMs keep range", "pathParams.rangeID"),
  op("destroyVm", "delete", "/vm/{vmID}", "Destroy one VM by Proxmox VMID", "pathParams.vmID; query: rangeID?"),
  op("getRangeConfig", "get", "/range/config", "Range config YAML", "query: rangeID*"),
  op(
    "setRangeConfig",
    "put",
    "/range/config",
    "Set range config (multipart on server; JSON via LUX preferred)",
    "query: rangeID*; prefer LUX putRangeConfig",
  ),
  op(
    "deployRange",
    "post",
    "/range/deploy",
    "Deploy range",
    "query: rangeID?; body: tags? (comma string), limit?, force?, only_roles?, verbose?",
  ),
  op("abortRange", "post", "/range/abort", "Abort deploy", "query: rangeID*"),
  op("getRangeLogs", "get", "/range/logs", "Live deploy logs", "query: rangeID*"),
  op("getRangeLogHistory", "get", "/range/logs/history", "Deploy log history", "query: rangeID*"),
  op(
    "getRangeLogHistoryById",
    "get",
    "/range/logs/history/{logID}",
    "One deploy log",
    "pathParams.logID; query: rangeID*",
  ),
  op("getRangeAnsibleInventory", "get", "/range/ansibleinventory", "Ansible inventory", "query: rangeID*"),
  op(
    "assignRange",
    "post",
    "/ranges/assign/{userID}/{rangeID}",
    "Assign range to user (admin)",
    "pathParams.userID, rangeID",
  ),

  // Power — official: PUT + query rangeID + body.machines
  op(
    "powerOnRange",
    "put",
    "/range/poweron",
    "Power on range VMs",
    'query: rangeID*; body: { machines: ["all"] } or VM names — NOT pathParams',
    ["power", "range"],
  ),
  op(
    "powerOffRange",
    "put",
    "/range/poweroff",
    "Power off range VMs",
    'query: rangeID*; body: { machines: ["all"] } or VM names — NOT pathParams',
    ["power", "range"],
  ),

  // Templates
  op("listTemplates", "get", "/templates", "List registered templates (built flag)"),
  op("getTemplateStatus", "get", "/templates/status", "Template build status"),
  op(
    "buildTemplates",
    "post",
    "/templates",
    "Packer-build registered template(s)",
    'body: { templates: ["exact-name"] }',
  ),
  op("abortTemplateBuild", "post", "/templates/abort", "Abort Packer build"),
  op("getTemplateLogs", "get", "/templates/logs", "Live Packer logs"),
  op("getTemplateLogHistory", "get", "/templates/logs/history", "Template build history"),
  op(
    "getTemplateLogHistoryById",
    "get",
    "/templates/logs/history/{logID}",
    "One template build log",
    "pathParams.logID",
  ),

  // Ansible
  op("listAnsible", "get", "/ansible", "Installed roles + collections"),
  op(
    "manageAnsibleRole",
    "post",
    "/ansible/role",
    "Install/remove Ansible role",
    'body: { role, action: "install"|"remove", version? }',
  ),
  op(
    "manageAnsibleCollection",
    "post",
    "/ansible/collection",
    "Install/remove Ansible collection",
    'body: { collection, action: "install"|"remove", version? }',
  ),

  // Testing mode
  op("startTesting", "put", "/testing/start", "Enter testing mode", "query: rangeID*"),
  op("stopTesting", "put", "/testing/stop", "Exit testing mode", "query: rangeID*"),
  op(
    "testingAllow",
    "post",
    "/testing/allow",
    "Allow domains/IPs in testing",
    "query: rangeID?; body: { domains?: string[], ips?: string[] }",
  ),
  op(
    "testingDeny",
    "post",
    "/testing/deny",
    "Deny/remove allowed domains/IPs",
    "query: rangeID?; body: { domains?: string[], ips?: string[] }",
  ),

  // Snapshots
  op("listSnapshots", "get", "/snapshots/list", "List VM snapshots", "query: rangeID?"),
  op(
    "createSnapshot",
    "post",
    "/snapshots/create",
    "Create snapshot",
    "query: rangeID?; body: name + VM selectors per api-docs",
  ),
  op(
    "rollbackSnapshot",
    "post",
    "/snapshots/rollback",
    "Rollback snapshot",
    "query: rangeID?; body: name + VM selectors",
  ),
  op(
    "removeSnapshot",
    "post",
    "/snapshots/remove",
    "Delete snapshot",
    "query: rangeID?; body: name + VM selectors",
  ),

  // Blueprints
  op("listBlueprints", "get", "/blueprints", "List blueprints"),
  op(
    "createBlueprintFromRange",
    "post",
    "/blueprints/from-range",
    "Create blueprint from range",
    "body: blueprintID, rangeID?, name?, description?",
  ),
  op("getBlueprint", "get", "/blueprints/{blueprintID}", "Blueprint detail", "pathParams.blueprintID"),
  op(
    "getBlueprintConfig",
    "get",
    "/blueprints/{blueprintID}/config",
    "Blueprint config YAML",
    "pathParams.blueprintID",
  ),
  op(
    "updateBlueprintConfig",
    "put",
    "/blueprints/{blueprintID}/config",
    "Update blueprint config",
    'pathParams.blueprintID; body: { config: "<yaml>" }',
  ),
  op(
    "installBlueprintDeps",
    "post",
    "/blueprints/{blueprintID}/install",
    "Install blueprint deps",
    "pathParams.blueprintID; body: global?, forceRoles?",
  ),
  op(
    "applyBlueprint",
    "post",
    "/blueprints/{blueprintID}/apply",
    "Apply blueprint to range",
    "pathParams.blueprintID; query: rangeID?",
  ),
  op("copyBlueprint", "post", "/blueprints/{blueprintID}/copy", "Copy blueprint", "pathParams.blueprintID"),
  op("deleteBlueprint", "delete", "/blueprints/{blueprintID}", "Delete blueprint", "pathParams.blueprintID"),
  op(
    "shareBlueprintUsers",
    "post",
    "/blueprints/{blueprintID}/share/users",
    "Share blueprint with users",
    "pathParams.blueprintID; body: userIDs[]",
  ),
  op(
    "shareBlueprintGroups",
    "post",
    "/blueprints/{blueprintID}/share/groups",
    "Share blueprint with groups",
    "pathParams.blueprintID; body: groupNames[]",
  ),
  op(
    "unshareBlueprintUsers",
    "delete",
    "/blueprints/{blueprintID}/share/users",
    "Unshare from users",
    "pathParams.blueprintID; body: userIDs[]",
  ),
  op(
    "unshareBlueprintGroups",
    "delete",
    "/blueprints/{blueprintID}/share/groups",
    "Unshare from groups",
    "pathParams.blueprintID; body: groupNames[]",
  ),
  op(
    "getBlueprintAccessUsers",
    "get",
    "/blueprints/{blueprintID}/access/users",
    "Blueprint user access",
    "pathParams.blueprintID",
  ),
  op(
    "getBlueprintAccessGroups",
    "get",
    "/blueprints/{blueprintID}/access/groups",
    "Blueprint group access",
    "pathParams.blueprintID",
  ),

  // Groups
  op("listGroups", "get", "/groups", "List groups"),
  op("createGroup", "post", "/groups", "Create group", "body: { name }"),
  op("deleteGroup", "delete", "/groups/{group}", "Delete group", "pathParams.group"),
  op(
    "addUsersToGroup",
    "post",
    "/groups/{group}/users",
    "Add users to group",
    "pathParams.group; body: { userIDs: string[] }",
  ),
  op(
    "removeUsersFromGroup",
    "delete",
    "/groups/{group}/users",
    "Remove users from group",
    "pathParams.group; body: { userIDs: string[] }",
  ),
  op(
    "listGroupMembers",
    "get",
    "/groups/{group}/users",
    "List group members",
    "pathParams.group",
  ),
  op(
    "addRangesToGroup",
    "post",
    "/groups/{group}/ranges",
    "Add ranges to group",
    "pathParams.group; body: { rangeIDs: string[] }",
  ),
  op(
    "removeRangesFromGroup",
    "delete",
    "/groups/{group}/ranges",
    "Remove ranges from group",
    "pathParams.group; body: { rangeIDs: string[] }",
  ),
  op("listGroupRanges", "get", "/groups/{group}/ranges", "List group ranges", "pathParams.group"),
]
