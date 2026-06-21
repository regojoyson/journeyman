export type NavScope = "workspace" | "org";

export type NavItem = {
  slug: string;
  icon: string;
  label: string;
};

export type NavGroup = {
  id: string;
  label: string;
  scope: NavScope;
  /** Only render for org admins / platform admins. */
  adminOnly?: boolean;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "workspace",
    label: "Workspace",
    scope: "workspace",
    items: [
      { slug: "dashboard", icon: "📊", label: "Dashboard" },
      { slug: "usage", icon: "📈", label: "Usage" },
      { slug: "workflows", icon: "⚡", label: "Workflows" },
      { slug: "workflow-instances", icon: "▶", label: "Workflow Instances" },
      { slug: "agents", icon: "🤖", label: "Agents" },
      { slug: "agent-runs", icon: "▶", label: "Agent Runs" },
      { slug: "custom-steps", icon: "🧩", label: "Custom Steps" },
    ],
  },
  {
    id: "integrations",
    label: "Integrations",
    scope: "workspace",
    items: [
      { slug: "connections", icon: "🔗", label: "Connections" },
      { slug: "mcps", icon: "🔌", label: "MCPs" },
      { slug: "skills", icon: "🎓", label: "Skills" },
      { slug: "webhooks", icon: "📡", label: "Webhooks" },
      { slug: "secrets", icon: "🔑", label: "Secrets" },
    ],
  },
  {
    id: "organization",
    label: "Organization",
    scope: "org",
    adminOnly: true,
    items: [
      { slug: "workspaces", icon: "🗂", label: "Workspaces" },
      { slug: "members", icon: "👥", label: "Members" },
      { slug: "secrets", icon: "🔐", label: "Org Secrets" },
      { slug: "sandboxes", icon: "👷", label: "Org Sandboxes" },
      { slug: "coding-models", icon: "🧠", label: "Coding Models" },
    ],
  },
];

/** Filter items by a case-insensitive label substring; drop groups left empty. */
export function filterGroups(groups: NavGroup[], query: string): NavGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => i.label.toLowerCase().includes(q)) }))
    .filter((g) => g.items.length > 0);
}

/** Build the route for an item given its group scope and the active ids. */
export function navHref(
  group: NavGroup,
  item: NavItem,
  workspaceId: string | null,
  orgId: string | null,
): string {
  return group.scope === "org"
    ? `/orgs/${orgId}/${item.slug}`
    : `/workspaces/${workspaceId}/${item.slug}`;
}

/** Avatar initials: first+last for multi-word, first two letters otherwise. */
export function initials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
