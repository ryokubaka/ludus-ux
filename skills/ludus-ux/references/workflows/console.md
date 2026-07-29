# Workflow: Console (VNC / SPICE)

## Prefer UI

- `/console` or VM console actions from Range / GOAD

## Agent

1. Console access is **LUX-only**: `list_lux_operations` query=`console`.
2. Typical: `GET /api/console/vnc-info`, `GET /api/console/spice` — need VM / range context from the user or current range.
3. Do not invent Proxmox ticket URLs; use LUX APIs then tell the user to open the Console page if the tool returns a viewer URL/path.
4. Destructive power ops (start/stop) are Ludus VM APIs — confirm first.
