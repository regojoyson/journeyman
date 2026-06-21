/**
 * Placeholder tokens and the renderer for agent notification message templates.
 * The agent run-finished hook (notify-on-terminal) builds a `vars` map and
 * substitutes {token}s; the UI lists NOTIFICATION_PLACEHOLDERS as a hint.
 */
export interface NotificationPlaceholder {
  token: string;        // e.g. "{agent}"
  description: string;  // shown as a UI hint
}

export const NOTIFICATION_PLACEHOLDERS: NotificationPlaceholder[] = [
  { token: "{agent}", description: "Agent name" },
  { token: "{status}", description: "completed or failed" },
  { token: "{runId}", description: "Workflow instance id" },
  { token: "{workflow}", description: "Workflow name" },
  { token: "{duration}", description: "Run duration (e.g. 1m 12s)" },
  { token: "{failedNode}", description: "Id of the node that failed (failure only)" },
];

/**
 * Replace known `{token}`s in `tpl` with `vars[token-without-braces]`.
 * Unknown tokens are left untouched (so a typo'd `{foo}` is visible, not silently
 * deleted).
 */
export function renderNotificationTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? vars[key] : match));
}
