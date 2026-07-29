# Pre-Built Ludus Environments

## Table of Contents

- [Official Ludus Documentation](#official-ludus-documentation)
- [Active Directory Environments](#active-directory-environments)
- [Security Tool Environments](#security-tool-environments)
- [Vulnerability Labs](#vulnerability-labs)
- [Quick Reference: Environment by Goal](#quick-reference-environment-by-goal)

## Official Ludus Documentation

- Environment Guides: https://docs.ludus.cloud/docs/category/environment-guides
- Build Templates (quick start): https://docs.ludus.cloud/docs/quick-start/build-templates
- General Configuration: https://docs.ludus.cloud/docs/configuration

## Active Directory Environments

### GOAD (Game of Active Directory)

**Description:** Multi-domain AD environment with 5 VMs for practicing AD attacks. Based on the popular GOAD project by Orange Cyberdefense.

**Templates Required:**
- `win2019-server-x64-template`
- `win2016-server-x64-template`

**Roles/Collections:**
- External GOAD provisioning (ansible playbooks run from local machine)

**Resources:** ~40GB RAM, 10+ CPUs recommended

**Setup:**
1. Clone `https://github.com/Orange-Cyberdefense/GOAD` and enter the repo.
2. Apply the Ludus provider config from `ad/GOAD/providers/ludus/config.yml` as the range config.
3. Deploy the range.
4. After deploy, run the GOAD ansible playbooks from the local machine.

**Ref:** https://github.com/Orange-Cyberdefense/GOAD

---

### GOAD-NHA (GOAD - NHA Variant)

**Description:** An alternative GOAD lab topology (NHA - Not Hardened Active Directory). Different domain structure for varied attack practice.

**Templates Required:**
- `win2019-server-x64-template`

**Setup:** Same workflow as GOAD but uses `ad/NHA/providers/ludus/` config.

---

### GOAD-SCCM

**Description:** GOAD variant that includes SCCM (System Center Configuration Manager) for practicing SCCM-specific attacks.

**Templates Required:**
- `win2019-server-x64-template`
- `win2016-server-x64-template`

**Setup:** Same workflow as GOAD but uses `ad/SCCM/providers/ludus/` config.

---

### GOAD-DRACARYS

**Description:** GOAD challenge variant targeting the `dracarys.lab` domain. Starting point is the Linux VM `lx01`; the goal is to reach domain admin without using vagrant credentials or recipe files.

**Templates Required:**
- `win2025-server-x64-tpm-template`
- `ubuntu-24.04-x64-server-template`

**Setup:**
1. Add and build the Windows 2025 and Ubuntu 24.04 templates.
2. Clone the GOAD project, set up its Python venv, and export your Ludus API key.
3. Run `./goad.sh -p ludus`, then in the GOAD shell run `set_lab DRACARYS` and `install`.
4. Optionally add a Kali VM to the range config.
5. Snapshot the VMs before testing.

**Access:** Optional Kali at `https://10.RANGENUMBER.10.99:8444` (`kali:password`) over WireGuard.

**Ref:** https://docs.ludus.cloud/docs/environment-guides/goad-dracarys

---

### Basic AD Network

**Description:** Simple Active Directory network with a DC, workstation, and Kali attack box. Good starting point for AD beginners.

**Templates Required:**
- `win2022-server-x64-template` or `win2019-server-x64-template`
- `win11-22h2-x64-enterprise-template`
- `kali-x64-desktop-template`

**Config:**
```yaml
ludus:
  - vm_name: "{{ range_id }}-ad-dc-win2022"
    hostname: "{{ range_id }}-DC01"
    template: win2022-server-x64-template
    vlan: 10
    ip_last_octet: 11
    ram_gb: 4
    cpus: 2
    windows:
      sysprep: true
    domain:
      fqdn: ludus.network
      role: primary-dc

  - vm_name: "{{ range_id }}-ad-win11"
    hostname: "{{ range_id }}-WIN11"
    template: win11-22h2-x64-enterprise-template
    vlan: 10
    ip_last_octet: 21
    ram_gb: 4
    cpus: 2
    windows:
      sysprep: true
    domain:
      fqdn: ludus.network
      role: member

  - vm_name: "{{ range_id }}-kali"
    hostname: "{{ range_id }}-kali"
    template: kali-x64-desktop-template
    vlan: 99
    ip_last_octet: 1
    ram_gb: 4
    cpus: 2
    linux: true
    testing:
      snapshot: false
      block_internet: false
```

---

### SANS Workshop: AD Privilege Escalation with Empire

**Description:** Self-guided AD security exercise covering Kerberos-based privilege escalation: Kerberoasting, DCSync, SID History Abuse, Unconstrained Delegation.

**Templates Required:**
- `win2019-server-x64-template`
- `kali-x64-desktop-template`

**Setup:**
1. Clone `https://github.com/aleemladha/SANS-Workshop-Lab`.
2. Apply `SANS-Workshop-Lab/ad/SANS/providers/ludus/config.yml` as the range config.
3. Deploy the range.
4. Then run the external ansible playbooks from the workshop repo.

**Workbook:** https://logout.gitbook.io/ad-privesc-with-empire

---

### SANS Workshop: Shadow Steps

**Description:** SANS workshop on detecting user impersonation and lateral movement in Active Directory. Covers Pass-the-Hash, Kerberoasting, token impersonation, and the corresponding detections in Elastic SIEM.

**Roles/Collections:**
- `badsectorlabs.ludus_elastic_container`
- `badsectorlabs.ludus_elastic_agent`

**Setup:**
1. Add the Elastic Ansible roles to the Ludus server.
2. Clone the workshop repo and apply the provided range config.
3. Deploy the range with `ludus range deploy`.
4. Install local Ansible deps (`ansible-core`, `pywinrm`).
5. Substitute the range number into the inventory and run the workshop's provisioning script.
6. Snapshot the VMs before testing. Provisioning takes several hours.

**Access:**
- Kali: `https://10.RANGENUMBER.50.99:8444` (`kali:password`)
- Elastic SIEM: `https://10.RANGENUMBER.20.1:5601` (`elastic:elasticpassword`)

**Ref:** https://docs.ludus.cloud/docs/environment-guides/shadow-steps

---

### BarbHack CTF 2024 (Gotham City AD Lab)

**Description:** CTF-style AD lab with multiple domains, trusts, and misconfigurations. Reproduces the BarbHack 2024 CTF environment.

**Templates Required:**
- `win2019-server-x64-template`

**Setup:**
1. Clone `https://github.com/Fromusic/GothamCity`.
2. Apply `GothamCity/ludus/config.yml` as the range config.
3. Deploy the range.
4. Then run the external ansible playbooks from the local machine.

---

### Netexec Workshop (leHACK 2024)

**Description:** Workshop environment for practicing with NetExec (formerly CrackMapExec) across an AD environment.

**Templates Required:**
- `win2019-server-x64-template`
- `win2016-server-x64-template`
- `kali-x64-desktop-template`

**Setup:** Uses external ansible playbooks from the workshop repo.

---

### Netexec Workshop (leHACK 2025)

**Description:** Updated NetExec workshop from leHACK 2025. Successor to the 2024 lab; the msol module section has been replaced with an LSASS dump exercise.

**Templates Required:**
- `win2019-server-x64-template`
- `kali-x64-desktop-template`

**Setup:**
1. Clone the NetExec-Lab repo (`https://github.com/Pennyw0rth/NetExec-Lab`).
2. Apply the provided range config and deploy.
3. Install local Ansible deps (`ansible-core`, `pywinrm`).
4. Substitute the range number into the inventory and run the workshop's provisioning script.
5. Snapshot the VMs before testing.

**Access:** Kali at `https://10.RANGENUMBER.10.99:8444` (`kali:password`) over WireGuard.

**Ref:** https://docs.ludus.cloud/docs/environment-guides/netexec-workshop-lehack-2025

---

## Security Tool Environments

### SCCM Lab

**Description:** Full Microsoft Configuration Manager (SCCM) environment with site server, SQL, distribution point, management point, DC, and workstation.

**Templates Required:**
- `win2022-server-x64-template`
- `win11-22h2-x64-enterprise-template`

**Collection:** `synzack.ludus_sccm`

**Important Notes:**
- `.local` domain suffixes do NOT work with SCCM - use `.domain` or `.lab`
- All 4 site server roles required (no standalone option)
- All SCCM hostnames must be 15 chars or less

**Setup:**
1. Add the `synzack.ludus_sccm` ansible collection.
2. Fetch the current range config, edit it to add the SCCM roles (see docs for a full example), and apply it back.
3. Deploy the range.

**Resources:** 6 VMs, ~24GB RAM minimum

---

### ADCS Lab (Active Directory Certificate Services)

**Description:** AD environment with misconfigured certificate services for practicing ADCS attacks (ESC1-9, ESC11, ESC13, ESC15).

**Templates Required:**
- `win2022-server-x64-template`
- `win11-22h2-x64-enterprise-template`

**Roles:** `badsectorlabs.ludus_adcs`

**Setup:**
1. Add the `badsectorlabs.ludus_adcs` ansible role.
2. Edit the range config to attach the ADCS role to the DC.
3. Deploy the range.

---

### Elastic Security Lab

**Description:** Elastic SIEM with Elastic Agent deployed to Windows endpoints. Includes Elasticsearch, Kibana, and Fleet Server.

**Templates Required:**
- `debian-12-x64-server-template`
- `win2019-server-x64-template` (or any Windows template)

**Roles:**
- `badsectorlabs.ludus_elastic_container` (on Linux server)
- `badsectorlabs.ludus_elastic_agent` (on Windows endpoints, depends on container)

**Config Example:**
```yaml
ludus:
  - vm_name: "{{ range_id }}-elastic"
    hostname: "{{ range_id }}-elastic"
    template: debian-12-x64-server-template
    vlan: 20
    ip_last_octet: 2
    ram_gb: 8
    cpus: 4
    linux: true
    roles:
      - badsectorlabs.ludus_elastic_container

  - vm_name: "{{ range_id }}-dc"
    hostname: "{{ range_id }}-DC01"
    template: win2019-server-x64-template
    vlan: 10
    ip_last_octet: 11
    ram_gb: 4
    cpus: 2
    windows:
      sysprep: true
    domain:
      fqdn: ludus.network
      role: primary-dc
    roles:
      - name: badsectorlabs.ludus_elastic_agent
        depends_on:
          - vm_name: "{{ range_id }}-elastic"
            role: badsectorlabs.ludus_elastic_container
```

---

### Splunk Attack Range

**Description:** Splunk instance with forwarders on Windows and Linux endpoints for detection engineering and threat hunting.

**Templates Required:**
- `ubuntu-22.04-x64-server-template` (must be added and built)
- `win2022-server-x64-template`

**Roles:**
- `p4t12ick.ludus_ar_splunk` (Splunk server)
- `p4t12ick.ludus_ar_windows` (Windows forwarder)
- `p4t12ick.ludus_ar_linux` (Linux forwarder)

**Setup:**
1. Add the Ubuntu 22.04 template first: clone `https://gitlab.com/badsectorlabs/ludus`, enter `ludus/templates`, register the `ubuntu-22.04-x64-server` template, and trigger a build.
2. Add the `p4t12ick.ludus_ar_splunk`, `p4t12ick.ludus_ar_windows`, and `p4t12ick.ludus_ar_linux` ansible roles.

**Resources:** Splunk server needs 16GB RAM, 8 CPUs

**Access:** Splunk web at `http://10.X.20.1:8000` (admin:changeme123!)

---

## Vulnerability Labs

### Malware Lab (xz Backdoor)

**Description:** Lab environment for analyzing the xz-utils backdoor (CVE-2024-3094). Includes a vulnerable system and analysis tools.

**Templates Required:**
- `debian-12-x64-server-template`

**Roles:** `badsectorlabs.ludus_xz_backdoor`

**Setup:**
1. Add the `badsectorlabs.ludus_xz_backdoor` ansible role.
2. Attach the role to the Debian VM in the range config.
3. Deploy the range.

---

### Vulhub

**Description:** Deploy Docker-based vulnerable environments from the Vulhub project. Supports hundreds of CVEs.

**Templates Required:**
- `debian-12-x64-server-template`

**Role:** `badsectorlabs.ludus_vulhub`

**Config:**
```yaml
ludus:
  - vm_name: "{{ range_id }}-vulhub"
    hostname: "{{ range_id }}-vulhub"
    template: debian-12-x64-server-template
    vlan: 20
    ip_last_octet: 1
    ram_gb: 4
    cpus: 2
    linux: true
    testing:
      snapshot: false
      block_internet: false
    roles:
      - badsectorlabs.ludus_vulhub
    role_vars:
      vulhub_envs:
        - confluence/CVE-2023-22527
        - airflow/CVE-2020-11978
```

**Setup:**
1. Add the `badsectorlabs.ludus_vulhub` ansible role.
2. Apply the edited range config.
3. Re-deploy with the `user-defined-roles` tag to run only the role changes.

---

### Pivot Lab

**Description:** Comprehensive network pivoting training lab with multiple network segments, exploitable services, and various pivoting tools pre-installed (chisel, ligolo-ng, socat, SSF, sshuttle, etc.).

**Templates Required:**
- `kali-x64-desktop-template`
- `debian-12-x64-server-template`
- `win2022-server-x64-template`

**Roles:**
- `badsectorlabs.ludus_vulhub`
- `geerlingguy.docker`

**Resources:** Multiple VMs across 3+ VLANs

**Covers:**
- SSH tunneling (local, remote, dynamic port forwarding)
- Chisel (forward/reverse SOCKS, port forwarding)
- Ligolo-ng (TUN-based pivoting)
- Socat (bidirectional relay)
- SSF (Secure Socket Funneling)
- sshuttle (VPN over SSH)
- Neo-reGeorg (HTTP tunneling)
- Weevely (web shell pivoting)
- CVE exploitation (CVE-2024-47176, CVE-2025-32433, CVE-2022-3229)

---

## Quick Reference: Environment by Goal

| Goal | Recommended Environment |
|------|------------------------|
| Learn AD attacks | Basic AD Network, GOAD |
| Practice Kerberos attacks | SANS Workshop |
| SCCM attacks | SCCM Lab, GOAD-SCCM |
| Certificate attacks (ADCS) | ADCS Lab |
| Detection engineering | Elastic Security Lab, Splunk Attack Range |
| Network pivoting | Pivot Lab |
| Malware analysis | Malware Lab |
| Web vulnerability practice | Vulhub |
| CTF practice | BarbHack CTF 2024 |
| Tool workshop (NetExec) | Netexec Workshop |
