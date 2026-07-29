---
name: range-config
description: Create, edit, and validate Ludus range configuration YAML including VM definitions, domains, networking, router settings, testing behavior, and role configuration. Use when users need help authoring or reviewing `ludus` range config files.
---

# Ludus Range Configuration

Use this skill to build safe, valid Ludus YAML configurations and explain tradeoffs in topology, networking, and role design.

## Key Principles

1. **Always suggest the YAML schema validation header** at the top of configs:
   ```yaml
   # yaml-language-server: $schema=https://docs.ludus.cloud/schemas/range-config.json
   ```

2. **Use `{{ range_id }}` template strings** in vm_name and hostname fields. This resolves to the user's range ID (e.g., "JS").

3. **Windows hostnames are limited to 15 characters** due to NETBIOS.

4. **VLANs must be 2-255** and become the third octet of the VM's IP (e.g., vlan 10 = 10.X.10.Y).

5. **ip_last_octet must be unique within a VLAN**.

6. **Set `linux: true`** for Linux VMs, **`windows:` key** for Windows VMs, **`macOS: true`** for macOS VMs.

7. **Domain roles** are: `primary-dc`, `alt-dc`, or `member`.

8. **role_vars must be a dictionary** - do not use hyphens to prefix variables.

9. **Roles must exist on the server** before deploy — verify installed roles and add any that are missing.

## Workflow

1. Clarify the target environment and intended use case.
2. Define required VMs and roles.
3. Verify that required templates are available on the server.
4. Build or revise YAML in small, valid increments.
5. Propose network rules and testing behavior appropriate for the scenario.
6. Verify that required Ansible roles/collections are installed; recommend any that need to be added.
7. Validate structure and values against the schema reference.

## References

- Use `references/schema.md` for full schema details, valid values, defaults, and complete examples.
- Use `https://docs.ludus.cloud/docs/configuration` for official configuration guidance.
- Use `https://docs.ludus.cloud/schemas/range-config.json` for schema-backed validation.
