# VM power on / off (Ludus)

**Before** powering VMs: know the **rangeID**. Use the UI selected range when present.

## Ops (Ludus only — `call_ludus_api`)

| Intent | operationId | Notes |
|--------|-------------|--------|
| Power off | `powerOffRange` | `PUT /range/poweroff` |
| Power on | `powerOnRange` | `PUT /range/poweron` |

## Call shape (critical)

```json
{
  "operationId": "powerOffRange",
  "query": { "rangeID": "<id>" },
  "body": { "machines": ["all"] }
}
```

- **query.rangeID** — required. Never put range id only in `pathParams`.
- **body.machines** — `["all"]` for whole range, or exact VM names from `getRange`.
- Destructive → wait for UI confirm (`needsConfirmation`). Do not invent success.

## Steps

1. If range unclear → ask (or use selected range from context).
2. Optional: `call_ludus_api` `getRange` with `query.rangeID` to list VM names.
3. `describe_ludus_operation` / `call_ludus_api` `powerOffRange` or `powerOnRange` as above.
4. Tell user to verify on Dashboard.

## Do not

- Invent operationIds.
- Use LUX for Ludus power (no LUX power route).
- Claim VMs are off/on without a successful tool result after confirm.
