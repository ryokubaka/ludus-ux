---
name: environment-guide
description: Discover, compare, and deploy pre-built Ludus cyber range environments for security training, attack simulation, and detection engineering. Use when users ask to choose a lab, verify prerequisites, or deploy known environments such as GOAD, SCCM, Elastic, or Vulhub.
---

# Ludus Environment Guide

Use this skill to map user goals to pre-built Ludus environments and provide reliable deployment guidance.

## Workflow

1. Clarify what the user wants to learn, test, or simulate.
2. Recommend one or more pre-built environments that match that objective.
3. Check prerequisites before deploy: required templates, required Ansible roles/collections, and minimum resources.
4. Guide the deployment steps in order and call out any external playbook steps.
5. Provide post-deploy next actions (validation checks, docs, and common follow-up commands).

## Key Considerations

- Resource requirements vary widely; include sizing guidance in recommendations.
- Verify required templates are available on the server before starting a deploy.
- Ensure required Ansible roles and collections are installed before deploy.
- Call out when setup depends on external Ansible playbooks run from the user machine.
- Remind users a WireGuard connection is required when running external Ansible against range VMs.

## References

- Use `references/environments.md` for the full environment catalog, requirements, and deployment notes.
- Use `https://docs.ludus.cloud/docs/category/environment-guides` for official environment guide updates.
- Use `https://docs.ludus.cloud/docs/quick-start/build-templates` to verify template setup prerequisites.
