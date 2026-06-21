/**
 * Preset starter templates for AGENT notifications (per-outcome, placeholder-driven).
 *
 * Distinct from NOTIFICATION_SCAFFOLDS (workflow send-message step): the step has
 * no placeholder renderer, so its scaffolds are plain prose. Agent presets use the
 * {placeholder} tokens that notify-on-terminal resolves at delivery time.
 */
export interface NotificationPreset {
  id: string;
  label: string;
  description: string;
  success: { subject: string; body: string };
  failure: { subject: string; body: string };
}

export const NOTIFICATION_PRESETS: NotificationPreset[] = [
  {
    id: "concise",
    label: "Concise",
    description: "One line per outcome",
    success: { subject: "{agent}: succeeded", body: "{agent} finished run {runId} in {duration}." },
    failure: { subject: "{agent}: failed", body: "{agent} failed run {runId} at {failedNode}." },
  },
  {
    id: "detailed",
    label: "Detailed",
    description: "Labelled multi-line",
    success: {
      subject: "✅ {agent} succeeded",
      body: "✅ {agent} succeeded\n\nRun: {runId}\nWorkflow: {workflow}\nDuration: {duration}",
    },
    failure: {
      subject: "❌ {agent} failed",
      body: "❌ {agent} failed\n\nRun: {runId}\nFailed at: {failedNode}\nDuration: {duration}",
    },
  },
  {
    id: "status",
    label: "Status only",
    description: "Minimal",
    success: { subject: "{agent} — {status}", body: "Run {runId}." },
    failure: { subject: "{agent} — {status}", body: "Run {runId}." },
  },
];
