# Range Configuration Schema Reference

The Ludus range configuration is a YAML document describing VMs, network rules, router settings, and defaults.

## Table of Contents

- [Official Ludus Documentation](#official-ludus-documentation)
- [Top-Level Keys](#top-level-keys)
- [VM Definition (`ludus[]`)](#vm-definition-ludus)
- [Global Role Variables (`global_role_vars`)](#global-role-variables-global_role_vars)
- [Router Configuration (`router`)](#router-configuration-router)
- [Network Configuration (`network`)](#network-configuration-network)
- [Defaults (`defaults`)](#defaults-defaults)
- [Notifications (`notify`)](#notifications-notify)
- [Complete Example](#complete-example)

## Official Ludus Documentation

- Configuration Guide: https://docs.ludus.cloud/docs/configuration
- Range Config Schema: https://docs.ludus.cloud/schemas/range-config.json

Add this to the top of any config for editor schema validation:
```yaml
# yaml-language-server: $schema=https://docs.ludus.cloud/schemas/range-config.json
```

## Top-Level Keys

| Key | Required | Description |
|-----|----------|-------------|
| `ludus` | Yes | Array of VM definitions |
| `global_role_vars` | No | Variables passed to ALL roles on ALL VMs |
| `router` | No | Router VM configuration |
| `network` | No | Network rules and firewall config |
| `defaults` | No | Default values for domains and deployment |
| `notify` | No | Notification URLs for deploy status |

---

## VM Definition (`ludus[]`)

Each entry in the `ludus` array defines a VM.

### Core Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `vm_name` | string | Yes | VM name in Proxmox. Use `{{ range_id }}` template. |
| `hostname` | string | Yes | VM hostname. Windows limited to 15 chars (NETBIOS). |
| `template` | string | Yes | Base template name. Must match a built template on the server. |
| `vlan` | int | Yes | VLAN number (2-255). Becomes 3rd octet of IP. |
| `ip_last_octet` | int | Yes | Last octet of IP (1–253). Must be unique in VLAN. |
| `ram_gb` | int | Yes | RAM allocation in GB. |
| `cpus` | int | Yes | CPU cores. Can over-provision. |

### OS Type Flags

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `linux` | bool/object | false | Set `true` for Linux VMs, or object with `packages` list. |
| `macOS` | bool | false | Set `true` for macOS VMs. |
| `windows` | object | - | Must be set for Windows VMs. All subkeys optional. |

### Windows Configuration (`windows`)

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `sysprep` | bool | false | Run sysprep before other tasks. |
| `gpos` | list | - | GPOs to create. Values: `disable_defender`, `anon_share_access`. |
| `chocolatey_packages` | list | - | Chocolatey packages to install. |
| `chocolatey_ignore_checksums` | bool | false | Ignore checksum errors for choco packages. |
| `office_version` | int | - | MS Office version: `2013`, `2016`, `2019`, `2021`. |
| `office_arch` | string | - | Office architecture: `64bit`, `32bit`. |
| `visual_studio_version` | int | - | VS Community version: `2017`, `2019`, `2022`. Note: 2022 cannot target < .NET 4.5. |
| `autologon_user` | string | localuser | Autologon username. Domain joined: `default.ad_domain_user`. |
| `autologon_password` | string | password | Autologon password. Domain joined: `default.ad_domain_user_password`. |
| `install_additional_tools` | bool | false | Install Firefox, Chrome, VSCode, Burp Suite, 7zip, Process Hacker, ILSpy, and other utilities. |

### Linux Configuration (`linux`)

When `linux` is an object:

| Property | Type | Description |
|----------|------|-------------|
| `packages` | list | Packages to install via apt/yum. |

### Domain Configuration (`domain`)

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `fqdn` | string | Yes | Domain FQDN (e.g., `ludus.network`). |
| `role` | string | Yes | `primary-dc`, `alt-dc`, or `member`. |

### Testing Configuration (`testing`)

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `snapshot` | bool | true | Snapshot on testing start, revert on stop. |
| `block_internet` | bool | true | Block internet during testing. |

> ⚠️ Domain-joined Windows VMs use their Domain Controller as their DNS server. If a domain-joined Windows VM has `testing.block_internet: false` but its DC does not, it will not be able to resolve addresses. Either set `testing.block_internet: false` on the DC as well, or point the Windows VM's DNS at the router VM (`10.X.Y.254`).

### Ansible Roles (`roles`)

Roles can be specified as simple strings or objects with dependencies:

```yaml
roles:
  - geerlingguy.docker              # Simple role
  - name: badsectorlabs.ludus_elastic_agent  # Role with dependency
    depends_on:
      - vm_name: "{{ range_id }}-elastic"
        role: badsectorlabs.ludus_elastic_container
```

### Role Variables (`role_vars`)

Key-value pairs passed to ALL roles on this VM. Must be a dictionary (no hyphens):

```yaml
role_vars:
  docker_edition: ce
  docker_users:
    - localuser
```

### Other VM Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `force_ip` | bool | false | Use config IP when qemu-guest-agent unavailable. For EDR appliances. |
| `unmanaged` | bool | false | VM can't report IP via proxmox. Must manually configure IP. |
| `ansible_groups` | list | - | Custom groups surfaced in the range ansible inventory. |
| `dns_rewrites` | list | - | DNS A records pointing to this VM's IP. Use `*.domain.com` for wildcards. |
| `primary_dns_server` | string | router | Override primary DNS. Default: `10.X.vlan.254`. |
| `secondary_dns_server` | string | - | Secondary DNS server. |
| `full_clone` | bool | false | Use a full clone (true) or linked clone (false). |

---

## Global Role Variables (`global_role_vars`)

Key-value pairs passed to ALL roles on ALL VMs in the range:

```yaml
global_role_vars:
  docker_edition: ce
```

---

## Router Configuration (`router`)

Optional. Ludus deploys a router VM with defaults if not specified.

| Property | Type | Description |
|----------|------|-------------|
| `vm_name` | string | Router VM name. |
| `hostname` | string | Router hostname. |
| `template` | string | Router template (default: debian-11-x64-server-template). |
| `ram_gb` | int | RAM in GB. |
| `ram_min_gb` | int | Minimum RAM (balloon). |
| `cpus` | int | CPU cores. |
| `roles` | list | Ansible roles (Enterprise only). |
| `role_vars` | dict | Role variables (Enterprise only). |
| `iptables_commands` | list | Custom iptables commands run after firewall setup. |

### Outbound WireGuard (Enterprise)

```yaml
router:
  outbound_wireguard_config: |-
    [Interface]
    PrivateKey = XXXX
    ...
  outbound_wireguard_vlans:
    - 10
```

### Inbound WireGuard (Enterprise)

```yaml
router:
  inbound_wireguard:
    enabled: true
    server_cidr: 10.254.254.0/24
    port: 51820
    allowed_vlans:
      - 10
```

---

## Network Configuration (`network`)

Optional. Controls firewall rules between VLANs and to the internet.

### Defaults

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `inter_vlan_default` | string | ACCEPT | Default inter-VLAN traffic rule. `ACCEPT`, `REJECT`, or `DROP`. |
| `external_default` | string | ACCEPT | Default outbound internet rule. |
| `wireguard_vlan_default` | string | ACCEPT | Default WireGuard client traffic rule. |
| `always_blocked_networks` | list | - | CIDRs that ranges can never reach. |

### Network Rules (`network.rules[]`)

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `name` | string | Yes | Rule name (added as iptables comment). |
| `vlan_src` | int/string | Yes | Source VLAN number, or `public`, `all`, `wireguard`. |
| `vlan_dst` | int/string | Yes | Destination VLAN number, or `public`, `all`, `wireguard`. |
| `protocol` | string | Yes | `tcp`, `udp`, `udplite`, `icmp`, `ipv6-icmp`, `esp`, `ah`, `sctp`, or `all`. |
| `ports` | string/int | Yes | Port number, range `start:end`, or `all`. |
| `action` | string | Yes | `ACCEPT`, `REJECT`, or `DROP`. |
| `ip_last_octet_src` | int/string | No | Limit source to a single host or a range string like `10-50`. |
| `ip_last_octet_dst` | int/string | No | Limit destination to a single host or a range string like `10-50`. |

Special VLAN values:
- `public` = `! 10.ID.0.0/16` (outside the range)
- `all` = `10.ID.0.0/16` (entire range)
- `wireguard` = `198.51.100.0/24`

### Example: Restrictive Network

```yaml
network:
  inter_vlan_default: REJECT
  rules:
    - name: Allow windows to kali on 443
      vlan_src: 10
      vlan_dst: 99
      protocol: tcp
      ports: 443
      action: ACCEPT
    - name: Allow kali full access to DC
      vlan_src: 99
      ip_last_octet_src: 1
      vlan_dst: 10
      ip_last_octet_dst: 11
      protocol: all
      ports: all
      action: ACCEPT
```

---

## Defaults (`defaults`)

Controls deployment and Active Directory settings. If defined, **all values must be set** as it overrides server defaults entirely.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `snapshot_with_RAM` | bool | true | Capture RAM in testing snapshots (allows revert to running VM). |
| `stale_hours` | int | 0 | Hours before pre-existing snapshot is retaken. |
| `ad_domain_functional_level` | string | Win2012R2 | Options: `Win2003`, `Win2008`, `Win2008R2`, `Win2012`, `Win2012R2`, `WinThreshold`, `Win2025`. |
| `ad_forest_functional_level` | string | Win2012R2 | Same options as domain functional level. |
| `ad_domain_admin` | string | domainadmin | Domain admin username. |
| `ad_domain_admin_password` | string | password | Domain admin password. |
| `ad_domain_user` | string | domainuser | Domain user username. |
| `ad_domain_user_password` | string | password | Domain user password. |
| `ad_domain_safe_mode_password` | string | password | Domain safe mode password. |
| `timezone` | string | America/New_York | TZ identifier format. |
| `enable_dynamic_wallpaper` | bool | true | Red/green wallpaper for Windows VMs. |

---

## Notifications (`notify`)

Send notifications when deployments finish or fail. Uses [Shoutrrr](https://containrrr.dev/shoutrrr/services/overview/) URLs.

```yaml
notify:
  urls:
    - "discord://token@webhookid"
    - "slack://[botname@]token-a/token-b/token-c"
    - "telegram://token@telegram?channels=channel-1"
    - "smtp://username:password@host:port/?fromAddress=from&toAddresses=to"
    - "ntfy://username:password@host:port/topic"
    - "teams://token-a/token-b/token-c"
    - "gotify://gotify-host/token"
    - "mattermost://[username@]host/token[/channel]"
```

Note: Special characters in usernames/passwords must be URL-encoded.

---

## Complete Example

```yaml
# yaml-language-server: $schema=https://docs.ludus.cloud/schemas/range-config.json

ludus:
  - vm_name: "{{ range_id }}-ad-dc-win2019-server-x64"
    hostname: "{{ range_id }}-DC01-2019"
    template: win2019-server-x64-template
    vlan: 10
    ip_last_octet: 11
    ram_gb: 8
    cpus: 4
    windows:
      sysprep: false
      gpos:
        - disable_defender
    domain:
      fqdn: ludus.network
      role: primary-dc
    testing:
      snapshot: true
      block_internet: true

  - vm_name: "{{ range_id }}-win11-workstation"
    hostname: "{{ range_id }}-WIN11-1"
    template: win11-22h2-x64-enterprise-template
    vlan: 10
    ip_last_octet: 21
    ram_gb: 8
    cpus: 4
    windows:
      sysprep: false
      chocolatey_packages:
        - vscodium
      office_version: 2019
      office_arch: 64bit
    domain:
      fqdn: ludus.network
      role: member

  - vm_name: "{{ range_id }}-kali"
    hostname: "{{ range_id }}-kali"
    template: kali-x64-desktop-template
    vlan: 99
    ip_last_octet: 1
    ram_gb: 8
    cpus: 4
    linux:
      packages:
        - curl
        - python3
    testing:
      snapshot: false
      block_internet: false

network:
  inter_vlan_default: REJECT
  rules:
    - name: Allow kali to DC
      vlan_src: 99
      vlan_dst: 10
      protocol: all
      ports: all
      action: ACCEPT

defaults:
  snapshot_with_RAM: true
  stale_hours: 0
  ad_domain_functional_level: Win2012R2
  ad_forest_functional_level: Win2012R2
  ad_domain_admin: domainadmin
  ad_domain_admin_password: password
  ad_domain_user: domainuser
  ad_domain_user_password: password
  ad_domain_safe_mode_password: password
  timezone: America/New_York
  enable_dynamic_wallpaper: true
```
