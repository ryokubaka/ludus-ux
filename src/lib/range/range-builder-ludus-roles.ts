/**
 * Field map for `badsectorlabs.ludus_windows_utils` roles.
 *
 * Variable names come from each role's `defaults/main.yml` and task asserts on
 * the collection's `main` branch. The collection README still documents older
 * names (for example `ludus_forest_trust_*`); the roles do not read those.
 */

export const LUDUS_WINDOWS_UTILS_COLLECTION = "badsectorlabs.ludus_windows_utils"

export type RoleFieldKind = "text" | "number" | "boolean" | "select" | "yaml"

export interface RoleField {
  key: string
  label: string
  kind: RoleFieldKind
  options?: readonly string[]
  placeholder?: string
  /** Written by a canvas relationship (trust edge, child domain); shown read-only on the VM. */
  managed?: boolean
}

export type RoleTarget = "dc" | "member" | "windows"

export interface LudusRoleDef {
  short: string
  fqcn: string
  summary: string
  target: RoleTarget
  fields: readonly RoleField[]
}

function def(short: string, summary: string, target: RoleTarget, fields: RoleField[]): LudusRoleDef {
  return { short, fqcn: `${LUDUS_WINDOWS_UTILS_COLLECTION}.${short}`, summary, target, fields }
}

export const FOREST_TRUST_ROLE = "ludus_ad_forest_trust"
export const CHILD_DOMAIN_ROLE = "ludus_child_domain"
export const CHILD_DOMAIN_JOIN_ROLE = "ludus_child_domain_join"

export const LUDUS_WINDOWS_UTILS_ROLES: readonly LudusRoleDef[] = [
  def(FOREST_TRUST_ROLE, "Bidirectional forest trust and DNS conditional forwarder", "dc", [
    { key: "ludus_trust_partner_domain", label: "Partner domain FQDN", kind: "text", managed: true },
    { key: "ludus_trust_partner_dc_ip", label: "Partner DC IP", kind: "text", managed: true },
    { key: "ludus_dns_forward_zone", label: "DNS forward zone", kind: "text", managed: true },
    { key: "ludus_dns_forward_server", label: "DNS forward server", kind: "text", managed: true },
    { key: "ludus_enable_sid_history", label: "Enable SID history", kind: "boolean", managed: true },
    { key: "ludus_cross_domain_group_members", label: "Cross-domain group members", kind: "yaml", managed: true },
  ]),
  def(CHILD_DOMAIN_ROLE, "Promote this server as a child domain DC", "dc", [
    { key: "ludus_child_domain_fqdn", label: "Child domain FQDN", kind: "text", managed: true },
    { key: "ludus_parent_domain_fqdn", label: "Parent domain FQDN", kind: "text", managed: true },
    { key: "ludus_parent_dc_ip", label: "Parent DC IP", kind: "text", managed: true },
    { key: "ludus_domain_admin_user", label: "Parent admin (UPN)", kind: "text", placeholder: "domainadmin@parent.local" },
    { key: "ludus_domain_admin_password", label: "Parent admin password", kind: "text" },
    { key: "ludus_safe_mode_password", label: "DSRM password", kind: "text" },
    { key: "ludus_create_dns_delegation", label: "Create DNS delegation", kind: "boolean" },
  ]),
  def(CHILD_DOMAIN_JOIN_ROLE, "Join this machine to a child domain", "member", [
    { key: "ludus_child_domain_fqdn", label: "Child domain FQDN", kind: "text", managed: true },
    { key: "ludus_child_dc_ip", label: "Child DC IP", kind: "text", managed: true },
    { key: "ludus_child_dc_hostname", label: "Child DC short hostname", kind: "text", managed: true },
    { key: "ludus_domain_admin_user", label: "Child admin (UPN)", kind: "text", placeholder: "administrator@child.parent.local" },
    { key: "ludus_domain_admin_password", label: "Child admin password", kind: "text" },
  ]),
  def("ludus_ad_password_policy", "Domain password and lockout policy", "dc", [
    { key: "ludus_password_policy_mode", label: "Mode", kind: "select", options: ["goad", "custom"] },
    { key: "ludus_password_policy_min_length", label: "Minimum length", kind: "number" },
    { key: "ludus_password_policy_complexity", label: "Require complexity", kind: "boolean" },
    { key: "ludus_password_policy_lockout_threshold", label: "Lockout threshold (0 = off)", kind: "number" },
    { key: "ludus_password_policy_lockout_duration", label: "Lockout duration", kind: "text", placeholder: "00:30:00" },
    { key: "ludus_password_policy_lockout_observation", label: "Lockout observation window", kind: "text", placeholder: "00:30:00" },
    { key: "ludus_password_policy_history_count", label: "History count", kind: "number" },
    { key: "ludus_password_policy_max_age_days", label: "Maximum age (days)", kind: "number" },
    { key: "ludus_password_policy_min_age_days", label: "Minimum age (days)", kind: "number" },
  ]),
  def("ludus_bulk_ad_content", "OUs, groups, and users", "dc", [
    { key: "ludus_ad_content_mode", label: "Mode", kind: "select", options: ["goad", "custom", "random"] },
    { key: "ludus_random_config", label: "Random generation settings", kind: "yaml" },
    { key: "ludus_organisation_units", label: "Organizational units", kind: "yaml" },
    { key: "ludus_groups", label: "Groups", kind: "yaml" },
    { key: "ludus_users", label: "Users", kind: "yaml" },
    { key: "ludus_multi_domain_group_members", label: "Cross-domain group members", kind: "yaml" },
  ]),
  def("ludus_ad_acls", "ACL entries for attack paths", "dc", [
    { key: "ludus_ad_acl_mode", label: "Mode", kind: "select", options: ["goad", "custom", "both"] },
    { key: "ludus_ad_acl_domain", label: "Domain override", kind: "text" },
    { key: "ludus_ad_acl_become_user", label: "Become user", kind: "text" },
    { key: "ludus_ad_acl_become_password", label: "Become password", kind: "text" },
    { key: "ludus_ad_acl_entries", label: "ACL entries", kind: "yaml" },
  ]),
  def("ludus_ad_anonymous_rpc", "Anonymous RPC and SMB enumeration", "dc", [
    { key: "ludus_anonymous_sam_enumeration", label: "Anonymous SAM enumeration", kind: "boolean" },
    { key: "ludus_anonymous_lsa_enumeration", label: "Anonymous LSA enumeration", kind: "boolean" },
    { key: "ludus_restrict_anonymous", label: "RestrictAnonymous", kind: "select", options: ["0", "1", "2"] },
    { key: "ludus_restrict_anonymous_sam", label: "RestrictAnonymousSAM", kind: "select", options: ["0", "1"] },
    { key: "ludus_anonymous_named_pipes", label: "Named pipes", kind: "yaml" },
    { key: "ludus_everyone_includes_anonymous", label: "Everyone includes anonymous", kind: "boolean" },
    { key: "ludus_null_session_fallback", label: "Null session fallback", kind: "boolean" },
  ]),
  def("ludus_ad_gmsa", "Group Managed Service Accounts", "dc", [
    { key: "ludus_gmsa_accounts", label: "gMSA accounts", kind: "yaml" },
  ]),
  def("ludus_ad_laps", "Microsoft LAPS", "windows", [
    { key: "ludus_laps_ou", label: "LAPS OU", kind: "text", placeholder: "OU=Laps,DC=domain,DC=local" },
    { key: "ludus_laps_gpo_name", label: "GPO name", kind: "text" },
    { key: "ludus_laps_readers", label: "Password readers", kind: "yaml" },
    { key: "ludus_laps_client_only", label: "Client only (not a DC)", kind: "boolean" },
    { key: "ludus_laps_domain_fqdn", label: "Domain FQDN override", kind: "text" },
  ]),
  def("ludus_ad_misconfigs", "Windows and AD misconfigurations", "windows", [
    { key: "ludus_misconfigs_mode", label: "Mode", kind: "select", options: ["custom", "goad"] },
    { key: "ludus_smb_signing_disabled", label: "Disable SMB signing", kind: "boolean" },
    { key: "ludus_ldap_signing_disabled", label: "Disable LDAP signing", kind: "boolean" },
    { key: "ludus_llmnr_enabled", label: "Enable LLMNR", kind: "boolean" },
    { key: "ludus_nbt_ns_enabled", label: "Enable NBT-NS", kind: "boolean" },
    { key: "ludus_ntlm_downgrade_enabled", label: "Allow NTLM downgrade", kind: "boolean" },
    { key: "ludus_print_spooler_enabled", label: "Enable Print Spooler", kind: "boolean" },
    { key: "ludus_webclient_enabled", label: "Enable WebClient", kind: "boolean" },
    { key: "ludus_windows_defender_disabled", label: "Disable Defender", kind: "boolean" },
    { key: "ludus_firewall_disabled", label: "Disable Windows Firewall", kind: "boolean" },
    { key: "ludus_lsa_ppl_enabled", label: "Enable LSA protection", kind: "boolean" },
    { key: "ludus_machine_account_quota_enabled", label: "Set MachineAccountQuota", kind: "boolean" },
    { key: "ludus_machine_account_quota_value", label: "MachineAccountQuota", kind: "number" },
    { key: "ludus_autologon_enabled", label: "Enable autologon", kind: "boolean" },
    { key: "ludus_autologon_user", label: "Autologon user", kind: "text" },
    { key: "ludus_autologon_password", label: "Autologon password", kind: "text" },
    { key: "ludus_autologon_domain", label: "Autologon domain", kind: "text" },
    { key: "ludus_asrep_roast_users", label: "AS-REP roastable users", kind: "yaml" },
    { key: "ludus_unconstrained_delegation_users", label: "Unconstrained delegation users", kind: "yaml" },
    { key: "ludus_unconstrained_delegation_computers", label: "Unconstrained delegation computers", kind: "yaml" },
    { key: "ludus_constrained_delegation_any", label: "Constrained delegation (any protocol)", kind: "yaml" },
    { key: "ludus_constrained_delegation_kerb_only", label: "Constrained delegation (Kerberos only)", kind: "yaml" },
    { key: "ludus_credential_manager_entries", label: "Credential Manager entries", kind: "yaml" },
    { key: "ludus_scheduled_tasks", label: "Scheduled tasks", kind: "yaml" },
    { key: "ludus_local_groups", label: "Local group members", kind: "yaml" },
  ]),
  def("ludus_smb_shares", "SMB shares", "windows", [
    { key: "ludus_smb_shares_mode", label: "Mode", kind: "select", options: ["custom", "goad"] },
    { key: "ludus_smb_shares", label: "Shares", kind: "yaml" },
  ]),
  def("ludus_iis_webdav", "IIS and WebDAV", "windows", [
    { key: "ludus_iis_webdav_mode", label: "Mode", kind: "select", options: ["client", "server", "both"] },
    { key: "ludus_webdav_client_start_service", label: "Start WebClient service", kind: "boolean" },
    { key: "ludus_iis_install_aspnet", label: "Install ASP.NET 4.5", kind: "boolean" },
    { key: "ludus_iis_install_legacy_compat", label: "IIS 6 compatibility", kind: "boolean" },
    { key: "ludus_iis_content_mode", label: "Content", kind: "select", options: ["none", "custom", "goad"] },
    { key: "ludus_iis_upload_dir", label: "Upload directory", kind: "text" },
    { key: "ludus_iis_webdav_authoring_rules", label: "Authoring rules", kind: "yaml" },
  ]),
  def("ludus_files", "Files, honeypots, and breadcrumbs", "windows", [
    { key: "ludus_files_mode", label: "Mode", kind: "select", options: ["custom", "goad", "honeypot", "breadcrumbs", "all"] },
    { key: "ludus_files_custom", label: "Custom files", kind: "yaml" },
    { key: "ludus_honeypot_enabled", label: "Honeypot files", kind: "boolean" },
    { key: "ludus_breadcrumbs_enabled", label: "Credential breadcrumbs", kind: "boolean" },
    { key: "ludus_breadcrumbs_custom", label: "Custom breadcrumbs", kind: "yaml" },
  ]),
]

/** Short role name for a range-config role reference (`fqcn`, `ns.role`, or bare role). */
export function roleShortName(roleRef: string): string {
  const parts = roleRef.trim().split(".")
  return parts[parts.length - 1] ?? ""
}

/**
 * Match a range-config role reference to a known windows_utils role.
 * Accepts the FQCN and the bare name used when roles are installed one by one.
 */
export function findLudusRoleDef(roleRef: string): LudusRoleDef | undefined {
  const ref = roleRef.trim()
  if (!ref) return undefined
  const parts = ref.split(".")
  if (parts.length === 1) return LUDUS_WINDOWS_UTILS_ROLES.find((r) => r.short === ref)
  if (parts.length === 3 && `${parts[0]}.${parts[1]}` === LUDUS_WINDOWS_UTILS_COLLECTION) {
    return LUDUS_WINDOWS_UTILS_ROLES.find((r) => r.short === parts[2])
  }
  return undefined
}

export function isLudusRole(roleRef: string, short: string): boolean {
  return findLudusRoleDef(roleRef)?.short === short
}
