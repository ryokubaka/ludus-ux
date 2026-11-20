import { ADCS_CONFIGURATIONS } from "@/lib/luxai/ask-fields"

const ADCS_CONFIGURATION_LINES = ADCS_CONFIGURATIONS.map((item) => `- ${item.id}: ${item.detail}`).join("\n")

export const LUXAI_SKILLS: Record<string, { title: string; body: string }> = {
  "lux-product": {
    title: "LUX workflows",
    body: `LUX is the web UI for a Ludus cyber range. The browser talks to LUX. LUX talks to the Ludus API as the signed-in user, and over SSH to the Ludus host.

Use these LUX surfaces, and do not invent a second control plane:
- Dashboard: VM power, deploy, abort, logs.
- Configuration and Range Builder: the same range-config.yml.
- Templates, Ansible Galaxy, Testing Mode, Snapshots, Blueprints, Sources.
- GOAD Management: one GOAD instance is one lab workspace linked to one Ludus range. LUXAI can propose creating that range, deleting a range, and starting the GOAD install. Provide and provision still run from the GOAD page after Apply. A GOAD install can rewrite the range config; firewall rules LUX saved are re-applied afterwards.
- Consoles: noVNC and SPICE for a VM the user can already open. LUXAI does not open a console session.

Deploy is slow. Propose it with the tags and limit the operator asked for. A full deploy with empty tags builds the whole range.

There is no LUX MCP. Agents outside LUX use the official Ludus MCP (\`@badsectorlabs/ludus-mcp\`) and the ludus-skills repository. Inside LUX, call the tools you were given. They use this user's Ludus API key.

Guest commands run on the Ludus host as one Ansible module against one inventory host, and only after the operator confirms. The host helper must be the copy shipped with this LUX version. A range-config edit does not need that helper.`,
  },
  "range-config": {
    title: "Ludus range config",
    body: `A Ludus range is one YAML document. Top-level keys you will see: ludus (required list of VMs), network, router, defaults, global_role_vars, ludus_extensions, notify. Unknown top-level keys are rejected. Put extension data in ludus_extensions.

Each VM needs vm_name, hostname, template, vlan (2-255), ip_last_octet (1-253), ram_gb, and cpus. Prefer "{{ range_id }}" inside names. The address shape is 10.{rangeNumber}.{vlan}.{ip_last_octet}. A Windows hostname is at most 15 characters after the range id is filled in.

A VM must set exactly one of windows, linux, or macOS. A Windows template needs a windows object, such as sysprep: false. A Linux template needs linux: true. Ludus rejects the config when that key is missing. domain.fqdn and domain.role (primary-dc, alt-dc, member) join a Windows VM to a domain. More than one primary-dc is more than one domain, and each one has its own fqdn. A workstation is not a domain member unless the person chose to join it. A joined VM on a different VLAN from the domain controller needs an allow rule both ways. Say that the join may fail when that path is missing, and name the VLAN, the allow rule, or leaving the VM off the domain as the fix. Do not set inter_vlan_default to reject unless the current config already does. roles is a list of role names or { name, depends_on }. role_vars is a map, not a list, and it applies to every role on that VM. global_role_vars applies to every VM. Install a role on the Ludus host before the config names it.

network.rules entries use vlan_src, vlan_dst, protocol, ports, and action. A VLAN number is an integer from 2 to 255. The only words for vlan_src or vlan_dst are public, all, and wireguard. A single ip_last_octet is an integer. A port range uses start:end, quoted. Do not quote a VLAN number. Do not invent passwords in defaults. Omit a password field to keep the server default.

Before propose_range_config, read the current config. The proposal stores that copy. Revert writes it back only when the live config still matches what was applied.

Read fetch_ludus_doc with slug "configuration" when you need the upstream schema rather than this summary.`,
  },
  goad: {
    title: "GOAD labs",
    body: `GOAD (Game of Active Directory) is a lab toolkit. LUX links one GOAD instance to one Ludus range. The instance id, lab name, extensions, and workspace live on the Ludus host under the GOAD install. LUX stores the instance-to-range link locally.

The standard GOAD lab on Ludus uses Windows VMs whose hostnames look like DC01, DC02, DC03, SRV02, and SRV03, on VLAN 10, with the range id prefixed to the Ludus VM name. Other labs (GOAD-Light, GOAD-Mini, NHA, SCCM) and extensions (including ADCS) add or replace machines. A request to deploy a lab is checked against the GOAD catalog on this server before anything is proposed. Trust the live range config and the GOAD inventory over this sketch.

Domains, trusts, and which host is a domain controller come from the lab's own inventory and from the range config after provide. Read get_inventory and describe_goad. Do not recite a password from memory. Inventory passwords are redacted until the operator names one account.

When the operator asks to create or deploy a GOAD lab and does not name a range, ask which existing range to use or for a new range id and name, then which extensions. Do not say that range creation is outside LUXAI. Propose it, and wait for Apply. A guest command is for a single checked change on a VM that is already deployed, not for re-running the lab's provisioner.

Credentials and vulnerable settings differ by lab version. Read them from the instance inventory.`,
  },
  "lab-adcs": {
    title: "AD CS lab settings",
    body: `The operator may ask for an AD CS lab setting without naming a range or which setting. Call ask_operator with a rangeId field and a configuration field. LUX turns those into dropdowns: the ranges this user can access, and the configurations below. Do not ask them to type a range id. Help them configure and check their own lab. Do not describe how to use the setting.

Configurations LUXAI can set:
${ADCS_CONFIGURATION_LINES}

Steps:
1. Read the range config and describe_goad for this range.
2. Identify the VM that hosts the lab CA. GOAD's ADCS extension is installed from the GOAD instance page.
3. Propose a guest command whose only effect is to print the attributes for the configuration they picked. Wait for confirmation.
4. When that command's output comes back, compare it with the configuration they picked. If those attributes already match, say so and stop. If they do not, propose the edit as a confirmed command, or as a range-config change when an Ansible role owns the setting. The journal keeps the previous range config. Say that a guest command cannot be reverted automatically.
5. After they apply the edit, the output comes back the same way. Propose a read-back of the same attributes. The check is that the attributes match the proposal.

Microsoft's advisory describes the product fix. Point the operator at that advisory and at the LUXAI change journal. Do not request certificates and do not describe enrollment, relay, or coercion.`,
  },
  "change-journal": {
    title: "Change journal",
    body: `Every mutation is a proposal until the operator presses Apply on the LUXAI page.
- range_config: the previous YAML is stored. Revert writes that YAML back when the live file still matches the applied copy.
- power and deploy: the request is stored. Revert does not undo a deploy or a power change; the operator powers or deploys again.
- guest_command: the exact command and the output are stored, up to 256,000 characters. Revert does not run an inverse command.

Reject leaves the range untouched. A proposal is bound to the signed-in user (or the user an admin is impersonating) and to one session.

Prefer a range-config edit when the change belongs in range-config.yml. Prefer a read-only guest command before a guest command that writes.`,
  },
}

export function listSkillNames(): string[] {
  return Object.keys(LUXAI_SKILLS)
}

export function readSkill(name: string): string | null {
  const skill = LUXAI_SKILLS[name]
  if (!skill) return null
  return `# ${skill.title}\n\n${skill.body}`
}
