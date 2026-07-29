# Ludus CLI Command Reference

## Table of Contents

- [Official Ludus Documentation](#official-ludus-documentation)
- [Global Flags](#global-flags)
- [apikey](#apikey)
- [range](#range)
- [templates](#templates)
- [testing](#testing)
- [power](#power)
- [snapshots](#snapshots)
- [ansible](#ansible)
- [users](#users)
- [groups](#groups)
- [blueprint](#blueprint)
- [vm](#vm)
- [Other Commands](#other-commands)

## Official Ludus Documentation

- CLI Reference: https://docs.ludus.cloud/docs/cli
- Using the CLI Locally (quick start): https://docs.ludus.cloud/docs/quick-start/using-cli-locally

## Global Flags

Available on all commands:

| Flag | Type | Description |
|------|------|-------------|
| `--config` | string | Config file (default: `$HOME/.config/ludus/config.yml`) |
| `-h, --help` | | Help for command |
| `--json` | | Format output as JSON |
| `--proxy` | string | HTTP(S) proxy URL |
| `--url` | string | Server URL (default: `https://198.51.100.1:8080`) |
| `-u, --user` | string | Impersonate user (admin only) |
| `-r, --range` | string | Target range ID |
| `--verbose` | | Verbose output |
| `--verify` | | Verify HTTPS certificate |

All flags can be set via environment variables: `LUDUS_FLAG_NAME` (uppercase).

---

## apikey

Store API key in system keyring.

```bash
ludus apikey
```

On headless Linux, use `LUDUS_API_KEY` environment variable instead.

---

## range

### range list

```bash
ludus range list        # Your range details
ludus range list all    # All accessible ranges
```

### range create

```bash
ludus range create -n "My Range" [-d "description"] [-o "purpose"] [--range-number 5] [--users "user1,user2"]
```

### range config get

```bash
ludus range config get          # Current config
ludus range config get example  # Example config
```

### range config set

```bash
ludus range config set -f config.yml [--force]
```

### range config edit

```bash
ludus range config edit [-e vim|nano|code] [--force]
```

### range default get/set

```bash
ludus range default get
ludus range default set <rangeID>
```

### range deploy

```bash
ludus range deploy                          # Full deploy
ludus range deploy -t network               # Only network rules
ludus range deploy -t user-defined-roles    # Only ansible roles
ludus range deploy -t custom-groups         # Only custom groups
ludus range deploy -t share                 # SMB share setup
ludus range deploy --only-roles rolename    # Specific role only
ludus range deploy -l "VM-pattern"          # Limit to VMs
ludus range deploy -v                       # Verbose ansible
ludus range deploy --force                  # Force if testing enabled
```

### range logs

```bash
ludus range logs          # Latest logs
ludus range logs -f       # Follow (live)
ludus range logs -t 50    # Last 50 lines
```

### range errors

```bash
ludus range errors    # Parse logs for fatal errors
```

### range abort

```bash
ludus range abort     # Kill running ansible
```

### range rm

```bash
ludus range rm [--no-prompt]    # Destroy VMs (keep range)
```

### range rm-range

```bash
ludus range rm-range [--no-prompt] [--force]    # Delete range from DB
```

### range inventory

```bash
ludus range inventory         # Ansible inventory
ludus range inventory --all   # All accessible ranges
```

### range gettags

```bash
ludus range gettags    # List available deploy tags
```

### range rdp

```bash
ludus range rdp [-o rdp-files.zip]    # RDP config files
```

### range etc-hosts

```bash
ludus range etc-hosts    # /etc/hosts format
```

### range taskoutput

```bash
ludus range taskoutput "task name"    # Output of specific ansible task
```

### range assign/revoke (admin)

```bash
ludus range assign <userID> <rangeID>
ludus range revoke <userID> <rangeID> [--force]
```

### range users (admin)

```bash
ludus range users <rangeID>
```

### range accessible

```bash
ludus range accessible    # Ranges you can access
```

---

## templates

### templates list

```bash
ludus templates list
```

### templates build

```bash
ludus templates build                      # Build all unbuilt
ludus templates build -n name1,name2       # Build specific
ludus templates build -p 2                 # Build 2 in parallel
```

### templates status

```bash
ludus templates status
```

### templates logs

```bash
ludus templates logs           # Latest logs
ludus templates logs -f        # Follow (live)
ludus templates logs -f -v     # Verbose packer output
ludus templates logs -t 100    # Last 100 lines
```

### templates add

```bash
ludus templates add -d ./template-dir [--force]
```

### templates abort

```bash
ludus templates abort    # Kill packer
```

### templates rm

```bash
ludus templates rm -n template-name
```

---

## testing

### testing status

```bash
ludus testing status    # Current testing state + allowed domains/IPs
```

### testing start

```bash
ludus testing start    # Snapshot VMs + block outbound
```

### testing stop

```bash
ludus testing stop [--force]    # Revert snapshots + restore outbound
```

### testing allow

```bash
ludus testing allow -d example.com                    # Allow domain
ludus testing allow -d "example.com,other.com"        # Multiple domains
ludus testing allow -i 1.2.3.4                        # Allow IP
ludus testing allow -i "1.2.3.4,5.6.7.8"             # Multiple IPs
ludus testing allow -f allowlist.txt                   # From file
```

### testing deny

```bash
ludus testing deny -d example.com      # Revoke domain
ludus testing deny -i 1.2.3.4          # Revoke IP
ludus testing deny -f denylist.txt     # From file
```

### testing update

```bash
ludus testing update -n "VM-name"    # Windows update on VM/group
```

---

## power

```bash
ludus power on -n "VM-name"       # Power on specific VM
ludus power on -n "vm1,vm2"       # Multiple VMs
ludus power on -n all             # All VMs
ludus power off -n "VM-name"      # Power off
ludus power off -n all            # All VMs
```

---

## snapshots

### snapshots list

```bash
ludus snapshots list                    # All VMs
ludus snapshots list -n "vmid1,vmid2"   # Specific VMs
```

### snapshots create

```bash
ludus snapshots create "snap-name" [-n vmids] [-d "description"] [--noRAM]
```

### snapshots revert

```bash
ludus snapshots revert "snap-name" [-n vmids]
```

### snapshots rm

```bash
ludus snapshots rm "snap-name" [-n vmids]
```

---

## ansible

### ansible role

```bash
ludus ansible role list                                    # List roles
ludus ansible role add <rolename>                          # Add from Galaxy
ludus ansible role add <url>                               # Add from URL
ludus ansible role add -d ./role-dir                       # Add from directory
ludus ansible role add <rolename> --version 1.2.3          # Specific version
ludus ansible role add <rolename> -f                       # Force reinstall
ludus ansible role add <rolename> -g                       # Install globally
ludus ansible role rm <rolename> [-f] [-g]                 # Remove role
ludus ansible role scope global <rolename>                 # Move to global
ludus ansible role scope local <rolename> [-c]             # Move to local (or copy)
```

### ansible collection

```bash
ludus ansible collection list                              # List collections
ludus ansible collection add <name> [--version 1.0.0] [-f] # Add collection
```

### ansible subscription-roles

```bash
ludus ansible subscription-roles list                      # List available
ludus ansible subscription-roles install -n "role1,role2" [-f] [-g]
```

---

## users

```bash
ludus users list              # Your info
ludus users list all          # All users (admin)
ludus users add -i <userid> -n "Name" -e "email" [-a] [-p password]
ludus users rm -i <userid> [--delete-range]
ludus users apikey [--no-prompt] [--value]
ludus users wireguard         # Get WireGuard config
ludus users creds get         # Get Proxmox creds
ludus users creds set -p <password> [-i userid]
```

---

## groups

```bash
ludus groups list
ludus groups create <name> [--description "desc"]
ludus groups delete <name>
ludus groups add user <userIDs> <groupName> [-m]     # -m for manager
ludus groups add range <rangeIDs> <groupName>
ludus groups remove user <userIDs> <groupName>
ludus groups remove range <rangeIDs> <groupName>
ludus groups members <groupName>
ludus groups ranges <groupName>
```

---

## blueprint

```bash
ludus blueprint list
ludus blueprint create --id <id> -n "name" [-d "desc"] [-s rangeID | -b blueprintID]
ludus blueprint apply <blueprintID> [-t targetRangeID] [--force]
ludus blueprint config get <blueprintID>
ludus blueprint access users <blueprintID>
ludus blueprint access groups <blueprintID>
ludus blueprint share user <blueprintID> <userIDs...>
ludus blueprint share group <blueprintID> <groupNames...>
ludus blueprint unshare user <blueprintID> <userIDs...>
ludus blueprint unshare group <blueprintID> <groupNames...>
ludus blueprint rm <blueprintID> [--no-prompt]
```

---

## vm

```bash
ludus vm destroy <vmID> [--no-prompt]
```

---

## Other Commands

### diagnostics

```bash
ludus diagnostics    # CPU, storage, performance info
```

### version

```bash
ludus version            # Client + server version
ludus version --verbose  # Detailed version info
```

### update

```bash
ludus update client    # Update CLI client
```

### migrate

```bash
ludus migrate    # Migrate SQLite to PostgreSQL
```

### completion

```bash
ludus completion bash
ludus completion zsh
ludus completion fish
ludus completion powershell
```

### antisandbox (Enterprise)

```bash
ludus antisandbox status
ludus antisandbox install-custom
ludus antisandbox install-standard
ludus antisandbox enable -n <vmids> [--vendor Dell|HP|Lenovo|Google] [--drop-files] [--persist]
```

### kms (Enterprise)

```bash
ludus kms install                          # Install KMS server
ludus kms license -n <vmids> [-p key]      # License Windows VMs
```
