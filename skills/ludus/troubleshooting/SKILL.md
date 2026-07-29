---
name: troubleshooting
description: Diagnose and resolve Ludus deployment, networking, template, WireGuard, Proxmox, and Ansible issues. Use when users report failures, errors, unreachable systems, failed joins, or unexpected behavior during build or deploy.
---

# Ludus Troubleshooting

Use this skill to triage user-reported failures quickly, categorize errors, and provide targeted remediation steps.

## Diagnostic Workflow

1. Gather context and exact error output.
2. Check range deployment status and recent errors.
3. Review deployment logs for failure details.
4. Identify the failure category using the known error catalog.
5. Inspect the current range config for misconfigurations.
6. Provide targeted fixes with concrete steps.
7. Define clear verification steps to confirm recovery.

## Key Diagnostic Information

When triaging, gather these in order of usefulness:

- **Range status** — is the deployment running, failed, or complete?
- **Deployment errors** — the most recent error output from a deploy.
- **Deployment logs** — full log stream for tracing failure context.
- **Template status** — are required templates built and available?
- **Range config** — does the YAML match what the user intended?
- **Testing mode status** — is testing mode active, and are network rules in effect?

## Common Patterns

- Network issues often trace back to dnsmasq or NAT bridge state.
- Ansible failures often involve WinRM (Windows) or SSH reachability (Linux).
- Domain join failures usually involve DNS ordering or timing.
- Template failures are commonly ISO download or disk-space related.

## References

- Use `references/common-errors.md` for known errors, root causes, and fix procedures.
- Use `https://docs.ludus.cloud/docs/troubleshooting/client` for client and CLI troubleshooting details.
- Use `https://docs.ludus.cloud/docs/troubleshooting/network/` and `https://docs.ludus.cloud/docs/troubleshooting/wireguard/` for network and connectivity issues.
- For uninstalling Ludus, direct users to the official guide at `https://docs.ludus.cloud/docs/troubleshooting/uninstall` rather than performing the steps yourself.
