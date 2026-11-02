export const pageTitles: Record<string, { title: string; description: string }> = {
  "/": { title: "Dashboard", description: "Overview of your Ludus range" },
  "/range": { title: "Range", description: "Virtual machines and range status" },
  "/range/new": { title: "Deploy New Range", description: "Create and deploy a new Ludus range" },
  "/range/config": { title: "Range Configuration", description: "Edit and deploy your range YAML config" },
  "/templates": { title: "Templates", description: "Manage VM templates for your range" },
  "/testing": { title: "Testing Mode", description: "Control testing state and firewall rules" },
  "/snapshots": { title: "Snapshots", description: "Create and manage VM snapshots" },
  "/blueprints": { title: "Blueprints", description: "Save, share, and reuse range configurations" },
  "/sources": { title: "Sources", description: "Register git catalogs for blueprints, templates, and Ansible content" },
  "/ansible": { title: "Ansible Galaxy", description: "Manage Ansible Galaxy roles and collections" },
  "/users": { title: "Users", description: "Manage Ludus users (admin only)" },
  "/groups": { title: "Groups", description: "Manage groups and range access" },
  "/admin": { title: "Ranges Overview", description: "All ranges, shared services, and cross-range VM management (admin only)" },
  "/admin/performance": { title: "Ludus Performance", description: "Live Proxmox node metrics (admin only)" },
  "/admin/app-logs": { title: "Application Logs", description: "Live auth and application event log (admin only)" },
  "/logs": { title: "Range Logs", description: "Live and historical range deployment logs" },
  "/console": { title: "Consoles", description: "VM console access" },
  "/goad": { title: "GOAD Management", description: "Manage Game of Active Directory lab instances" },
  "/ludushound": { title: "LudusHound", description: "Deploy AD replicas from BloodHound data via LudusHound" },
  "/ludushound/new": { title: "Deploy LudusHound", description: "Generate and deploy a LudusHound range" },
  "/settings": { title: "Settings", description: "Configure Ludus connection and preferences" },
  "/account": { title: "User Settings", description: "Profile picture and password" },
}

export function resolvePageInfo(pathname: string): { title: string; description: string } {
  const matchedKey = Object.keys(pageTitles)
    .sort((a, b) => b.length - a.length)
    .find((key) => pathname === key || (key !== "/" && pathname.startsWith(key + "/")))

  return (matchedKey && pageTitles[matchedKey]) || {
    title: "Ludus UX",
    description: "Cyber Range Manager",
  }
}
