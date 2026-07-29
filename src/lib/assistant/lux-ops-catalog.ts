/** Auto-derived LUX /api/* operations for assistant list/call tools.
 * Merged with docs/openapi.yaml so missing routes still appear.
 */
import type { OpenApiOperation } from "./openapi-tools"

export const LUX_OPS_CATALOG: OpenApiOperation[] = [
  {
    "operationId": "postRangeAbort",
    "method": "post",
    "path": "/api/range/abort",
    "summary": "POST /api/range/abort",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/range/abort"
  },
  {
    "operationId": "getRangePbStatus",
    "method": "get",
    "path": "/api/range/pb-status",
    "summary": "GET /api/range/pb-status",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/range/pb-status"
  },
  {
    "operationId": "getRangeLogEnrichment",
    "method": "get",
    "path": "/api/range/log-enrichment",
    "summary": "GET /api/range/log-enrichment",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/range/log-enrichment"
  },
  {
    "operationId": "postRangeTestingActivity",
    "method": "post",
    "path": "/api/range/testing-activity",
    "summary": "POST /api/range/testing-activity",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/range/testing-activity"
  },
  {
    "operationId": "postRangeDeployTagRun",
    "method": "post",
    "path": "/api/range/deploy-tag-run",
    "summary": "POST /api/range/deploy-tag-run",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/range/deploy-tag-run"
  },
  {
    "operationId": "getRangeTestingStopPreflight",
    "method": "get",
    "path": "/api/range/testing-stop-preflight",
    "summary": "GET /api/range/testing-stop-preflight",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/range/testing-stop-preflight"
  },
  {
    "operationId": "getAllowedDomains",
    "method": "get",
    "path": "/api/range/allowed-domains",
    "summary": "GET /api/range/allowed-domains",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/range/allowed-domains"
  },
  {
    "operationId": "postRangeReconcilePb",
    "method": "post",
    "path": "/api/range/reconcile-pb",
    "summary": "POST /api/range/reconcile-pb",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/range/reconcile-pb"
  },
  {
    "operationId": "getRangeIpPlan",
    "method": "get",
    "path": "/api/range/ip-plan",
    "summary": "GET /api/range/ip-plan",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/range/ip-plan"
  },
  {
    "operationId": "getRangeConfig",
    "method": "get",
    "path": "/api/range/config",
    "summary": "GET /api/range/config",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/range/config"
  },
  {
    "operationId": "putRangeConfig",
    "method": "put",
    "path": "/api/range/config",
    "summary": "PUT /api/range/config",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "PUT /api/range/config"
  },
  {
    "operationId": "getRangeOp",
    "method": "get",
    "path": "/api/range/ops",
    "summary": "GET /api/range/ops",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/range/ops"
  },
  {
    "operationId": "createRangeOp",
    "method": "post",
    "path": "/api/range/ops",
    "summary": "POST /api/range/ops",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/range/ops"
  },
  {
    "operationId": "postRangeForceState",
    "method": "post",
    "path": "/api/range/force-state",
    "summary": "POST /api/range/force-state",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/range/force-state"
  },
  {
    "operationId": "createRange",
    "method": "post",
    "path": "/api/range/create",
    "summary": "POST /api/range/create",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/range/create"
  },
  {
    "operationId": "deletePendingAllows",
    "method": "delete",
    "path": "/api/range/pending-allows",
    "summary": "DELETE /api/range/pending-allows",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "DELETE /api/range/pending-allows"
  },
  {
    "operationId": "getPendingAllows",
    "method": "get",
    "path": "/api/range/pending-allows",
    "summary": "GET /api/range/pending-allows",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/range/pending-allows"
  },
  {
    "operationId": "addPendingAllow",
    "method": "post",
    "path": "/api/range/pending-allows",
    "summary": "POST /api/range/pending-allows",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/range/pending-allows"
  },
  {
    "operationId": "streamLogs",
    "method": "get",
    "path": "/api/logs/stream",
    "summary": "GET /api/logs/stream",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/logs/stream"
  },
  {
    "operationId": "postSshPruneKnownHosts",
    "method": "post",
    "path": "/api/ssh/prune-known-hosts",
    "summary": "POST /api/ssh/prune-known-hosts",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/ssh/prune-known-hosts"
  },
  {
    "operationId": "login",
    "method": "post",
    "path": "/api/auth/login",
    "summary": "POST /api/auth/login",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/auth/login"
  },
  {
    "operationId": "logout",
    "method": "post",
    "path": "/api/auth/logout",
    "summary": "POST /api/auth/logout",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/auth/logout"
  },
  {
    "operationId": "getSession",
    "method": "get",
    "path": "/api/auth/session",
    "summary": "GET /api/auth/session",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/auth/session"
  },
  {
    "operationId": "deleteAuthImpersonate",
    "method": "delete",
    "path": "/api/auth/impersonate",
    "summary": "DELETE /api/auth/impersonate",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "DELETE /api/auth/impersonate"
  },
  {
    "operationId": "getAuthImpersonate",
    "method": "get",
    "path": "/api/auth/impersonate",
    "summary": "GET /api/auth/impersonate",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/auth/impersonate"
  },
  {
    "operationId": "postAuthImpersonate",
    "method": "post",
    "path": "/api/auth/impersonate",
    "summary": "POST /api/auth/impersonate",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/auth/impersonate"
  },
  {
    "operationId": "changeUserPassword",
    "method": "post",
    "path": "/api/users/change-password",
    "summary": "POST /api/users/change-password",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/users/change-password"
  },
  {
    "operationId": "postUsersPurgePocketbaseLogs",
    "method": "post",
    "path": "/api/users/purge-pocketbase-logs",
    "summary": "POST /api/users/purge-pocketbase-logs",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/users/purge-pocketbase-logs"
  },
  {
    "operationId": "rollUserApiKey",
    "method": "post",
    "path": "/api/users/roll-key",
    "summary": "POST /api/users/roll-key",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/users/roll-key"
  },
  {
    "operationId": "deleteTemplate",
    "method": "delete",
    "path": "/api/templates/delete",
    "summary": "DELETE /api/templates/delete",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "DELETE /api/templates/delete"
  },
  {
    "operationId": "listTemplateSources",
    "method": "get",
    "path": "/api/templates/sources",
    "summary": "GET /api/templates/sources",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/templates/sources"
  },
  {
    "operationId": "addTemplates",
    "method": "post",
    "path": "/api/templates/add",
    "summary": "POST /api/templates/add",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/templates/add"
  },
  {
    "operationId": "executeGoad",
    "method": "post",
    "path": "/api/goad/execute",
    "summary": "POST /api/goad/execute",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/goad/execute"
  },
  {
    "operationId": "listGoadInstances",
    "method": "get",
    "path": "/api/goad/instances",
    "summary": "GET /api/goad/instances",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/goad/instances"
  },
  {
    "operationId": "postGoadInstancesReassign",
    "method": "post",
    "path": "/api/goad/instances/reassign",
    "summary": "POST /api/goad/instances/reassign",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/goad/instances/reassign"
  },
  {
    "operationId": "deleteGoadInstancesByInstanceidPendingNetwork",
    "method": "delete",
    "path": "/api/goad/instances/{instanceId}/pending-network",
    "summary": "DELETE /api/goad/instances/{instanceId}/pending-network",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "DELETE /api/goad/instances/{instanceId}/pending-network"
  },
  {
    "operationId": "getGoadInstancesByInstanceidPendingNetwork",
    "method": "get",
    "path": "/api/goad/instances/{instanceId}/pending-network",
    "summary": "GET /api/goad/instances/{instanceId}/pending-network",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/goad/instances/{instanceId}/pending-network"
  },
  {
    "operationId": "postGoadInstancesByInstanceidPendingNetwork",
    "method": "post",
    "path": "/api/goad/instances/{instanceId}/pending-network",
    "summary": "POST /api/goad/instances/{instanceId}/pending-network",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/goad/instances/{instanceId}/pending-network"
  },
  {
    "operationId": "initGoadInstanceRange",
    "method": "post",
    "path": "/api/goad/instances/{instanceId}/init-range",
    "summary": "POST /api/goad/instances/{instanceId}/init-range",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/goad/instances/{instanceId}/init-range"
  },
  {
    "operationId": "postGoadInstancesByInstanceidRefreshWorkspace",
    "method": "post",
    "path": "/api/goad/instances/{instanceId}/refresh-workspace",
    "summary": "POST /api/goad/instances/{instanceId}/refresh-workspace",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/goad/instances/{instanceId}/refresh-workspace"
  },
  {
    "operationId": "getGoadInventories",
    "method": "get",
    "path": "/api/goad/instances/{instanceId}/inventories",
    "summary": "GET /api/goad/instances/{instanceId}/inventories",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/goad/instances/{instanceId}/inventories"
  },
  {
    "operationId": "forceDeleteGoadInstance",
    "method": "post",
    "path": "/api/goad/instances/{instanceId}/force-delete",
    "summary": "POST /api/goad/instances/{instanceId}/force-delete",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/goad/instances/{instanceId}/force-delete"
  },
  {
    "operationId": "postGoadInstancesByInstanceidSyncNetwork",
    "method": "post",
    "path": "/api/goad/instances/{instanceId}/sync-network",
    "summary": "POST /api/goad/instances/{instanceId}/sync-network",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/goad/instances/{instanceId}/sync-network"
  },
  {
    "operationId": "syncGoadIps",
    "method": "post",
    "path": "/api/goad/instances/{instanceId}/sync-ips",
    "summary": "POST /api/goad/instances/{instanceId}/sync-ips",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/goad/instances/{instanceId}/sync-ips"
  },
  {
    "operationId": "postGoadInstancesByInstanceidRemoveExtension",
    "method": "post",
    "path": "/api/goad/instances/{instanceId}/remove-extension",
    "summary": "POST /api/goad/instances/{instanceId}/remove-extension",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/goad/instances/{instanceId}/remove-extension"
  },
  {
    "operationId": "setGoadInstanceRange",
    "method": "post",
    "path": "/api/goad/instances/set-range",
    "summary": "POST /api/goad/instances/set-range",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/goad/instances/set-range"
  },
  {
    "operationId": "getGoadByRange",
    "method": "get",
    "path": "/api/goad/by-range",
    "summary": "GET /api/goad/by-range",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/goad/by-range"
  },
  {
    "operationId": "getGoadCatalog",
    "method": "get",
    "path": "/api/goad/catalog",
    "summary": "GET /api/goad/catalog",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/goad/catalog"
  },
  {
    "operationId": "refreshGoadCatalog",
    "method": "post",
    "path": "/api/goad/catalog",
    "summary": "POST /api/goad/catalog",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/goad/catalog"
  },
  {
    "operationId": "postGoadPreviewConfig",
    "method": "post",
    "path": "/api/goad/preview-config",
    "summary": "POST /api/goad/preview-config",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/goad/preview-config"
  },
  {
    "operationId": "listGoadTasks",
    "method": "get",
    "path": "/api/goad/tasks",
    "summary": "GET /api/goad/tasks",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/goad/tasks"
  },
  {
    "operationId": "getGoadTasksEvents",
    "method": "get",
    "path": "/api/goad/tasks/events",
    "summary": "GET /api/goad/tasks/events",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/goad/tasks/events"
  },
  {
    "operationId": "getGoadTask",
    "method": "get",
    "path": "/api/goad/tasks/{taskId}",
    "summary": "GET /api/goad/tasks/{taskId}",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/goad/tasks/{taskId}"
  },
  {
    "operationId": "patchGoadTasksByTaskid",
    "method": "patch",
    "path": "/api/goad/tasks/{taskId}",
    "summary": "PATCH /api/goad/tasks/{taskId}",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "PATCH /api/goad/tasks/{taskId}"
  },
  {
    "operationId": "streamGoadTask",
    "method": "get",
    "path": "/api/goad/tasks/{taskId}/stream",
    "summary": "GET /api/goad/tasks/{taskId}/stream",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/goad/tasks/{taskId}/stream"
  },
  {
    "operationId": "postGoadTasksByTaskidLinkInstance",
    "method": "post",
    "path": "/api/goad/tasks/{taskId}/link-instance",
    "summary": "POST /api/goad/tasks/{taskId}/link-instance",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/goad/tasks/{taskId}/link-instance"
  },
  {
    "operationId": "stopGoadTask",
    "method": "post",
    "path": "/api/goad/tasks/{taskId}/stop",
    "summary": "POST /api/goad/tasks/{taskId}/stop",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/goad/tasks/{taskId}/stop"
  },
  {
    "operationId": "patchGoadDeployHandoff",
    "method": "patch",
    "path": "/api/goad/deploy-handoff",
    "summary": "PATCH /api/goad/deploy-handoff",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "PATCH /api/goad/deploy-handoff"
  },
  {
    "operationId": "postGoadDeployHandoff",
    "method": "post",
    "path": "/api/goad/deploy-handoff",
    "summary": "POST /api/goad/deploy-handoff",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/goad/deploy-handoff"
  },
  {
    "operationId": "postDebugAgentLog",
    "method": "post",
    "path": "/api/debug-agent-log",
    "summary": "POST /api/debug-agent-log",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/debug-agent-log"
  },
  {
    "operationId": "getSources",
    "method": "get",
    "path": "/api/sources",
    "summary": "GET /api/sources",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/sources"
  },
  {
    "operationId": "postSources",
    "method": "post",
    "path": "/api/sources",
    "summary": "POST /api/sources",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/sources"
  },
  {
    "operationId": "deleteSourcesBySourceid",
    "method": "delete",
    "path": "/api/sources/{sourceId}",
    "summary": "DELETE /api/sources/{sourceId}",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "DELETE /api/sources/{sourceId}"
  },
  {
    "operationId": "getSourcesBySourceidTemplates",
    "method": "get",
    "path": "/api/sources/{sourceId}/templates",
    "summary": "GET /api/sources/{sourceId}/templates",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/sources/{sourceId}/templates"
  },
  {
    "operationId": "getSourcesBySourceidBlueprints",
    "method": "get",
    "path": "/api/sources/{sourceId}/blueprints",
    "summary": "GET /api/sources/{sourceId}/blueprints",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/sources/{sourceId}/blueprints"
  },
  {
    "operationId": "postSourcesBySourceidSync",
    "method": "post",
    "path": "/api/sources/{sourceId}/sync",
    "summary": "POST /api/sources/{sourceId}/sync",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/sources/{sourceId}/sync"
  },
  {
    "operationId": "getSourcesBySourceidRoles",
    "method": "get",
    "path": "/api/sources/{sourceId}/roles",
    "summary": "GET /api/sources/{sourceId}/roles",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/sources/{sourceId}/roles"
  },
  {
    "operationId": "postSourcesBySourceidInstall",
    "method": "post",
    "path": "/api/sources/{sourceId}/install",
    "summary": "POST /api/sources/{sourceId}/install",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/sources/{sourceId}/install"
  },
  {
    "operationId": "getSourcesBySourceidCollections",
    "method": "get",
    "path": "/api/sources/{sourceId}/collections",
    "summary": "GET /api/sources/{sourceId}/collections",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/sources/{sourceId}/collections"
  },
  {
    "operationId": "postBlueprintsDelete",
    "method": "post",
    "path": "/api/blueprints/delete",
    "summary": "POST /api/blueprints/delete",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/blueprints/delete"
  },
  {
    "operationId": "getBlueprintsSources",
    "method": "get",
    "path": "/api/blueprints/sources",
    "summary": "GET /api/blueprints/sources",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/blueprints/sources"
  },
  {
    "operationId": "postBlueprintsShare",
    "method": "post",
    "path": "/api/blueprints/share",
    "summary": "POST /api/blueprints/share",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/blueprints/share"
  },
  {
    "operationId": "postBlueprintsImportFromSource",
    "method": "post",
    "path": "/api/blueprints/import-from-source",
    "summary": "POST /api/blueprints/import-from-source",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/blueprints/import-from-source"
  },
  {
    "operationId": "getVmOperationLog",
    "method": "get",
    "path": "/api/vm-operation-log",
    "summary": "GET /api/vm-operation-log",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/vm-operation-log"
  },
  {
    "operationId": "postVmOperationLog",
    "method": "post",
    "path": "/api/vm-operation-log",
    "summary": "POST /api/vm-operation-log",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/vm-operation-log"
  },
  {
    "operationId": "postProfileChangePassword",
    "method": "post",
    "path": "/api/profile/change-password",
    "summary": "POST /api/profile/change-password",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/profile/change-password"
  },
  {
    "operationId": "deleteProfileAvatar",
    "method": "delete",
    "path": "/api/profile/avatar",
    "summary": "DELETE /api/profile/avatar",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "DELETE /api/profile/avatar"
  },
  {
    "operationId": "getProfileAvatar",
    "method": "get",
    "path": "/api/profile/avatar",
    "summary": "GET /api/profile/avatar",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/profile/avatar"
  },
  {
    "operationId": "postProfileAvatar",
    "method": "post",
    "path": "/api/profile/avatar",
    "summary": "POST /api/profile/avatar",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/profile/avatar"
  },
  {
    "operationId": "getAnsibleGalaxySearch",
    "method": "get",
    "path": "/api/ansible/galaxy/search",
    "summary": "GET /api/ansible/galaxy/search",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/ansible/galaxy/search"
  },
  {
    "operationId": "getSpiceConsole",
    "method": "get",
    "path": "/api/console/spice",
    "summary": "GET /api/console/spice",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/console/spice"
  },
  {
    "operationId": "getVncInfo",
    "method": "get",
    "path": "/api/console/vnc-info",
    "summary": "GET /api/console/vnc-info",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/console/vnc-info"
  },
  {
    "operationId": "healthCheck",
    "method": "get",
    "path": "/api/health",
    "summary": "GET /api/health",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/health"
  },
  {
    "operationId": "postSessionSelectedRange",
    "method": "post",
    "path": "/api/session/selected-range",
    "summary": "POST /api/session/selected-range",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/session/selected-range"
  },
  {
    "operationId": "getChangelog",
    "method": "get",
    "path": "/api/changelog",
    "summary": "GET /api/changelog",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/changelog"
  },
  {
    "operationId": "adminDeleteRangeOwnership",
    "method": "delete",
    "path": "/api/admin/ranges-data",
    "summary": "DELETE /api/admin/ranges-data",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "DELETE /api/admin/ranges-data"
  },
  {
    "operationId": "adminGetRangesData",
    "method": "get",
    "path": "/api/admin/ranges-data",
    "summary": "GET /api/admin/ranges-data",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/admin/ranges-data"
  },
  {
    "operationId": "adminAssignRange",
    "method": "post",
    "path": "/api/admin/ranges-data",
    "summary": "POST /api/admin/ranges-data",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/admin/ranges-data"
  },
  {
    "operationId": "adminFetchUserApikey",
    "method": "get",
    "path": "/api/admin/fetch-user-apikey",
    "summary": "GET /api/admin/fetch-user-apikey",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/admin/fetch-user-apikey"
  },
  {
    "operationId": "deleteAdminVm",
    "method": "delete",
    "path": "/api/admin/vm",
    "summary": "DELETE /api/admin/vm",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "DELETE /api/admin/vm"
  },
  {
    "operationId": "putAdminVm",
    "method": "put",
    "path": "/api/admin/vm",
    "summary": "PUT /api/admin/vm",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "PUT /api/admin/vm"
  },
  {
    "operationId": "postAdminUserRole",
    "method": "post",
    "path": "/api/admin/user-role",
    "summary": "POST /api/admin/user-role",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/admin/user-role"
  },
  {
    "operationId": "getAdminAppLogs",
    "method": "get",
    "path": "/api/admin/app-logs",
    "summary": "GET /api/admin/app-logs",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/admin/app-logs"
  },
  {
    "operationId": "getAdminAppLogsStream",
    "method": "get",
    "path": "/api/admin/app-logs/stream",
    "summary": "GET /api/admin/app-logs/stream",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/admin/app-logs/stream"
  },
  {
    "operationId": "getAdminSharedVms",
    "method": "get",
    "path": "/api/admin/shared-vms",
    "summary": "GET /api/admin/shared-vms",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/admin/shared-vms"
  },
  {
    "operationId": "postAdminDeploySharedService",
    "method": "post",
    "path": "/api/admin/deploy-shared-service",
    "summary": "POST /api/admin/deploy-shared-service",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/admin/deploy-shared-service"
  },
  {
    "operationId": "getAdminUserWireguard",
    "method": "get",
    "path": "/api/admin/user-wireguard",
    "summary": "GET /api/admin/user-wireguard",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/admin/user-wireguard"
  },
  {
    "operationId": "getAbout",
    "method": "get",
    "path": "/api/about",
    "summary": "GET /api/about",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/about"
  },
  {
    "operationId": "getSettings",
    "method": "get",
    "path": "/api/settings",
    "summary": "GET /api/settings",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/settings"
  },
  {
    "operationId": "updateSettings",
    "method": "post",
    "path": "/api/settings",
    "summary": "POST /api/settings",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/settings"
  },
  {
    "operationId": "postSettingsTestCredentials",
    "method": "post",
    "path": "/api/settings/test-credentials",
    "summary": "POST /api/settings/test-credentials",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/settings/test-credentials"
  },
  {
    "operationId": "getSettingsProxmoxNodeMetrics",
    "method": "get",
    "path": "/api/settings/proxmox-node-metrics",
    "summary": "GET /api/settings/proxmox-node-metrics",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/settings/proxmox-node-metrics"
  },
  {
    "operationId": "postAssistantAnswer",
    "method": "post",
    "path": "/api/assistant/answer",
    "summary": "POST /api/assistant/answer",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/assistant/answer"
  },
  {
    "operationId": "assistantChat",
    "method": "post",
    "path": "/api/assistant/chat",
    "summary": "POST /api/assistant/chat",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/assistant/chat"
  },
  {
    "operationId": "listAssistantModels",
    "method": "get",
    "path": "/api/assistant/models",
    "summary": "GET /api/assistant/models",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/assistant/models"
  },
  {
    "operationId": "pullAssistantModel",
    "method": "post",
    "path": "/api/assistant/models/pull",
    "summary": "POST /api/assistant/models/pull",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/assistant/models/pull"
  },
  {
    "operationId": "getAssistantDocsSeed",
    "method": "get",
    "path": "/api/assistant/docs/seed",
    "summary": "GET /api/assistant/docs/seed",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/assistant/docs/seed"
  },
  {
    "operationId": "postAssistantDocsSeed",
    "method": "post",
    "path": "/api/assistant/docs/seed",
    "summary": "POST /api/assistant/docs/seed",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/assistant/docs/seed"
  },
  {
    "operationId": "getAssistantRunsByRunidStream",
    "method": "get",
    "path": "/api/assistant/runs/{runId}/stream",
    "summary": "GET /api/assistant/runs/{runId}/stream",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/assistant/runs/{runId}/stream"
  },
  {
    "operationId": "testAssistantLlm",
    "method": "post",
    "path": "/api/assistant/test",
    "summary": "POST /api/assistant/test",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/assistant/test"
  },
  {
    "operationId": "postAssistantConfirm",
    "method": "post",
    "path": "/api/assistant/confirm",
    "summary": "POST /api/assistant/confirm",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/assistant/confirm"
  },
  {
    "operationId": "getAssistantConversations",
    "method": "get",
    "path": "/api/assistant/conversations",
    "summary": "GET /api/assistant/conversations",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/assistant/conversations"
  },
  {
    "operationId": "postAssistantConversations",
    "method": "post",
    "path": "/api/assistant/conversations",
    "summary": "POST /api/assistant/conversations",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/assistant/conversations"
  },
  {
    "operationId": "deleteAssistantConversationsById",
    "method": "delete",
    "path": "/api/assistant/conversations/{id}",
    "summary": "DELETE /api/assistant/conversations/{id}",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "DELETE /api/assistant/conversations/{id}"
  },
  {
    "operationId": "getAssistantConversationsById",
    "method": "get",
    "path": "/api/assistant/conversations/{id}",
    "summary": "GET /api/assistant/conversations/{id}",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/assistant/conversations/{id}"
  },
  {
    "operationId": "putAssistantConversationsById",
    "method": "put",
    "path": "/api/assistant/conversations/{id}",
    "summary": "PUT /api/assistant/conversations/{id}",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "PUT /api/assistant/conversations/{id}"
  },
  {
    "operationId": "postAssistantConversationsByIdCancel",
    "method": "post",
    "path": "/api/assistant/conversations/{id}/cancel",
    "summary": "POST /api/assistant/conversations/{id}/cancel",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/assistant/conversations/{id}/cancel"
  },
  {
    "operationId": "deleteLogo",
    "method": "delete",
    "path": "/api/logo",
    "summary": "DELETE /api/logo",
    "destructive": true,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "DELETE /api/logo"
  },
  {
    "operationId": "getLogo",
    "method": "get",
    "path": "/api/logo",
    "summary": "GET /api/logo",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/logo"
  },
  {
    "operationId": "uploadLogo",
    "method": "post",
    "path": "/api/logo",
    "summary": "POST /api/logo",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "POST /api/logo"
  },
  {
    "operationId": "getLudusSharePicker",
    "method": "get",
    "path": "/api/ludus/share-picker",
    "summary": "GET /api/ludus/share-picker",
    "destructive": false,
    "tags": [
      "lux-catalog"
    ],
    "callHints": "GET /api/ludus/share-picker"
  }
] as OpenApiOperation[]
