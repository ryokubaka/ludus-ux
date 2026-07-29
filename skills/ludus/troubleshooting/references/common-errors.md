# Common Errors and Solutions

## Table of Contents

- [Official Ludus Documentation](#official-ludus-documentation)
- [Network Issues](#network-issues)
- [WireGuard Issues](#wireguard-issues)
- [Proxmox Issues](#proxmox-issues)
- [Ansible / Deployment Issues](#ansible--deployment-issues)
- [Template Issues](#template-issues)
- [Packer Cache Cleanup](#packer-cache-cleanup)
- [API Key Issues](#api-key-issues)
- [Flare-VM Issues](#flare-vm-issues)
- [Verbose Diagnostics](#verbose-diagnostics)
- [KasmVNC Issues](#kasmvnc-issues)

## Official Ludus Documentation

- Client Troubleshooting: https://docs.ludus.cloud/docs/troubleshooting/client
- Network Troubleshooting: https://docs.ludus.cloud/docs/troubleshooting/network/
- WireGuard Troubleshooting: https://docs.ludus.cloud/docs/troubleshooting/wireguard/
- API Key Issues: https://docs.ludus.cloud/docs/troubleshooting/api-key-issues/
- Packer Cache Cleanup: https://docs.ludus.cloud/docs/troubleshooting/packer-cache-cleanup

## Network Issues

### Templates Cannot Connect to the Internet

**Symptoms:** VMs get APIPA addresses (169.254.x.x) or cannot reach the internet.

**Solutions (try in order):**

1. **Restart dnsmasq** (most common fix):
   ```bash
   systemctl restart dnsmasq
   ```
   Even if running, dnsmasq may not be listening. Restarting often fixes it.

2. **Check NAT interface is UP:**
   ```bash
   # Get your NAT interface name
   cat /opt/ludus/config.yml | grep ludus_nat_interface
   # Check interface status
   ip a
   # If DOWN, bring it up
   ifup vmbr1000
   ```

3. **Verify MASQUERADE rule:**
   ```bash
   iptables -nvL -t nat
   # Should show: MASQUERADE 0 -- * vmbr0 192.0.2.0/24 0.0.0.0/0
   ```

4. **Check for port 53 conflicts:**
   ```bash
   systemctl status dnsmasq
   # Programs like conmand may conflict on port 53
   ```

### Unable to Access Range After Granting Access

**Solutions:**
1. Fetch an updated WireGuard config for the affected user.
2. Re-deploy networking on the target range using the `network` tag.

---

## WireGuard Issues

### Invalid Handshake Initiation Error

**Error:** `Error: Invalid handshake initiation from ...`

**Fix:**
```bash
# 1. Comment out user's peer in /etc/wireguard/wg0.conf
# 2. Sync config
wg syncconf wg0 <(wg-quick strip wg0)
# 3. Uncomment user's peer
# 4. Sync again
wg syncconf wg0 <(wg-quick strip wg0)
```

### TCP Connections Hang

**Cause:** Running WireGuard inside another VPN (not recommended).

**Fix:**
```bash
# Enable MSS clamping
/sbin/iptables -t mangle -A FORWARD -p tcp -m tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
```

If still not working, lower MTU on both server and client:
```ini
# In /etc/wireguard/wg0.conf
[Interface]
MTU = 1284  # Default is 1400, try lower values
```

### Debugging WireGuard

```bash
# Enable debug logging
echo module wireguard +p > /sys/kernel/debug/dynamic_debug/control

# Watch logs
dmesg -HwT | grep wireguard

# Disable debug
echo module wireguard -p > /sys/kernel/debug/dynamic_debug/control
```

---

## Proxmox Issues

### Web Interface Blank or 500 Errors

**Symptom:** Blank page or error loading `/PVE/StdWorkspace.js`.

**Fix:**
```bash
apt install --reinstall proxmox-widget-toolkit
# Then reload the web page
```

### API Returns 596 Timeout Errors

**Cause:** Large deployments (500+ VMs) exceed the 30-second pveproxy timeout.

**Fix:** Edit `/usr/share/perl5/PVE/APIServer/AnyEvent.pm`, change line ~833:
```perl
timeout => 90, # was previously 30
```
Then restart: `systemctl restart pveproxy`

**Alternative:** Use `pvesh` from root shell (bypasses pveproxy).

---

## Ansible / Deployment Issues

### Ansible "Failed to create temporary directory" Error

**Error:** `UNREACHABLE! => {"changed": false, "msg": "Failed to create temporary directory...exited with result 1", "unreachable": true}`

**Key indicator:** `"unreachable": true`

**Fix:** Check that the target VM is powered on and reachable. Power cycle the VM if needed, then re-run the deploy.

### Unable to Retrieve API Task ID from Node

**Error:** `Unable to retrieve API task ID from node <node name> HTTPSConnectionPool(host='<node name>', port=8006): Read timed out.`

**Cause:** SSL certificate issue on existing Proxmox installs.

**Fix:**
```bash
# Test connectivity
curl https://<node name>:8006/
# If SSL error, copy the CA cert
cp /etc/pve/pve-root-ca.pem /usr/local/share/ca-certificates/pve-root-ca.crt
update-ca-certificates
```

### Idempotency Tip

Ludus actions are idempotent. If ansible fails, often simply re-running the deploy will succeed on the second attempt. Complex VMs sometimes need a retry.

### General Deployment Debugging

When a deploy fails, work through these in order:

- **Range status** — confirm whether the deployment is running, failed, or complete.
- **Live logs** — stream the deploy log to see where execution stopped.
- **Fatal errors** — pull only the fatal error output for the latest deploy.
- **Task output** — inspect the output of a specific named task to see the exact failure.
- **Targeted re-run by tag** — re-deploy only the stage relevant to the failure.
- **Targeted re-run by role** — re-run only a specific ansible role.
- **Limit to specific VMs** — scope a re-deploy to one or more VMs matching a pattern.
- **Verbose ansible output** — increase verbosity to see underlying ansible detail.

### Common Ansible Tags for Targeted Re-deployment

- `network` — re-deploy network and firewall rules.
- `user-defined-roles` — re-run only ansible roles.
- `custom-groups` — update ansible groups.
- `share` — set up SMB shares (with `anon_share_access` GPO).

---

## Template Issues

### Template Build Failures

When a template build fails, work through these:

- **Build status** — check whether a build is running, failed, or succeeded.
- **Packer logs** — stream the packer build log to see where it stopped.
- **Verbose packer output** — increase verbosity when the failure cause is unclear.
- **Abort** — cancel a stuck build before retrying.
- **Retry a specific template** — re-run the build for one named template.

### Kali APT `undefined symbol` Error

**Error:** `ImportError: ...apt_pkg.cpython-312-x86_64-linux-gnu.so: undefined symbol`

**Cause:** Known Kali bug preventing package installation after initial install.

**Workaround:** Comment out the provisioner block in `/opt/ludus/packer/kali/kali.pkr.hcl`:
```hcl
build {
  sources = ["source.proxmox-iso.kali"]
  // Comment out the entire provisioner "ansible" block
}
```
This gives a base Kali template without KasmVNC. KasmVNC can be installed manually.

### Kali Template GRUB Error

If the Kali template fails during GRUB installation:

1. Open Proxmox web UI, find the VM, open Console via noVNC
2. Press Alt+F2 to get a console
3. Run:
   ```bash
   chroot /target bash
   echo -e "#!/bin/bash\nexec true" > /sbin/start-stop-daemon
   chmod +x /sbin/start-stop-daemon
   ```
4. Run `apt reinstall dpkg`
5. Press Alt+F1 to return, press Enter to continue
6. Select "Install the GRUB boot loader" to finish

---

## Packer Cache Cleanup

ISOs accumulate in `/opt/ludus/users/USERNAME/packer/packer_cache`.

**Check cache size:**
```bash
du -sh /opt/ludus/users/$LUDUS_USER/packer/packer_cache
```

**Clean old ISOs (30+ days):**
```bash
find /opt/ludus/users/$LUDUS_USER/packer/packer_cache -type f -name "*.iso" -mtime +30 -delete
```

**Automated weekly cleanup (cron):**
```cron
0 2 * * 0 find /opt/ludus/users/$LUDUS_USER/packer/packer_cache -type f -name "*.iso" -mtime +30 -delete
```

---

## API Key Issues

### Recover API Key (Admin Key Known)

As an admin, regenerate an API key for the target user with `ludus user apikey --user <userID>`.

### Recover API Key (No Admin Key)

1. SSH to the Ludus host as root.
2. Run `cat /opt/ludus/install/root-api-key` to retrieve the ROOT key.
3. Use the ROOT key to reset the target user's API key: `LUDUS_API_KEY='<ROOT key>' ludus user apikey --user <userID>`.

---

## Flare-VM Issues

### Disable Defender Error (Blocked by Antivirus)

**Error:** `ScriptContainedMaliciousContent` when running `Add-MpPreference -ExclusionPath`

**Fix:** Use the dedicated `flare-vm` template instead of a generic Windows template.

1. Clone the Ludus repo from `https://gitlab.com/badsectorlabs/ludus.git` and enter the `templates` directory.
2. Add the `flare-vm` template from the local directory.
3. Build templates.
4. Set `template: flare-vm-template` in your range config.

---

## Verbose Diagnostics

When reporting bugs, request verbose output for the failing operation. Verbose output includes config values, API endpoints, and response bodies. API keys are redacted after the `.` (shows userID only), so verbose output is safe to share in bug reports.

---

## KasmVNC Issues

### No Stylesheet Loaded

Known bug. Workaround:
1. Open web inspector, go to Network tab
2. Reload the page
3. Double-click `style.dist.css` to open in new window
4. Reload the KasmVNC page

