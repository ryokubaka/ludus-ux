# About LUX

## Why use LUX?

- **Operators and builders** who prefer visual workflows, shared UIs, and fewer copy-paste errors across SSH sessions.
- **Training and lab leads** who need impersonation, group-based access, blueprint sharing, and inventory visibility in one place.
- **Red/blue/purple teams** who want Ludus features (isolation, snapshots, range YAML) with extra glue: GOAD task history, admin range overview, shared-service helpers, and more.

## Ludus Pro vs LUX

Ludus ships a first-party **Pro Web UI** with a commercial license. Teams can request a **Pro NFR (Not For Resale)** license at no cost for qualified use — see [Ludus pricing](https://ludus.cloud/#pricing). That path gives you the native supported UI and Pro capabilities under Bad Sector Labs’ terms.

**LUX** is **Apache-2.0**, community-driven, and overlaps many Pro-style workflows (range design, consoles, templates, blueprints, GOAD, admin tooling) while adding its own features and integrations. Pick official Pro if you want vendor-supported closed-source plugins and SLAs; pick **LUX** if you want open source, forkability, and the feature set described in [Features](features.md) (you can even run both in parallel for comparison).

## GOAD and Ludus — how they fit together

**Ludus** is the infrastructure layer: it manages Proxmox VMs, networking, snapshots, and Ansible role deployments. Think of it as the "cloud provider" for your lab.

**GOAD** (Game of Active Directory) is a content layer: it installs pre-configured Active Directory environments (domains, users, vulnerable services) into VMs that Ludus manages. GOAD does not know about Proxmox directly — it works through the Ludus CLI.

When you deploy a GOAD lab in LUX:
1. LUX uses SSH to run GOAD commands on the Ludus server
2. GOAD calls `ludus range deploy` internally to build VMs
3. GOAD then runs its own Ansible playbooks to configure Active Directory
4. LUX re-applies any firewall rules you configured after GOAD finishes (since GOAD's Ansible step overwrites the range config)

The result: you get a fully configured AD lab in an isolated network without manually coordinating two separate tools. LUX handles the handoff so you do not need to understand the internal protocol between GOAD and Ludus.

See [Workflows](workflows.md) for a plain-English walkthrough of the deploy process.

## Future enhancements

**Multi-extension batch install** — Install multiple GOAD extensions in a single queued session. Each extension would get its own Ludus deploy + GOAD task, with a progress indicator and the ability to cancel remaining items. Deferred until the single-extension flow is proven stable.
