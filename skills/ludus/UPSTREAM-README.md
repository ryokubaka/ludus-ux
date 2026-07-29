# Ludus Skills

AI agent skills for [Ludus](https://ludus.cloud) — the open-source cyber range platform built on Proxmox.

These skills give AI coding agents (Claude Code, Cursor, Windsurf, etc.) deep knowledge of Ludus range configuration, CLI commands, troubleshooting, and pre-built environments.

## Installation

```bash
npx skills add badsectorlabs/ludus-skills
```

## Skills

### `range-config`
Build, edit, and validate Ludus range YAML configurations. Covers all 200+ configuration parameters including VM definitions, network rules, domain config, Ansible roles, and testing mode.

### `troubleshooting`
Diagnose and fix common Ludus deployment issues. Includes a catalog of known errors with root causes and solutions across networking, Ansible, templates, WinRM, Active Directory, and more.

### `environment-guide`
Discover and deploy pre-built Ludus environments — GOAD, DVCP, DVWA, Elastic SIEM, SCCM, Malware Lab, and more. Includes prerequisites, required templates, and ready-to-use config snippets.

### `ludus-cli`
Complete Ludus CLI reference with usage examples. Covers the full range lifecycle: deploy, manage templates, configure testing mode, administer users/groups, and manage blueprints.

## About Ludus

Ludus is an open-source cyber range platform that makes it easy to spin up complex Active Directory environments, security labs, and training networks. Learn more at [docs.ludus.cloud](https://docs.ludus.cloud).
