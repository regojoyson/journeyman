import type { Composition } from "../composition-types.ts";
import type { HumanTaskNotifyConfig } from "@journeyman/core";

/**
 * Best-effort notification when a `human-task` node enters waiting.
 * Failures are logged and swallowed — they must not fail the workflow.
 *
 * v1: delivery is logged. Wiring an INotificationProvider for real Slack/email
 * delivery is intentionally deferred until SlackProvider ships beyond stub.
 */
export async function notifyOnHumanTaskPause(
  _c: Composition,
  args: {
    workflowInstanceId: string;
    nodeId: string;
    notify: HumanTaskNotifyConfig;
    prompt?: string;
  },
): Promise<void> {
  try {
    const link = buildResolveLink(args.workflowInstanceId, args.nodeId);
    const body = [args.notify.message ?? args.prompt ?? "You have a task waiting.", link]
      .filter(Boolean)
      .join("\n\n");

    console.log(
      `[human-task notify] channel=${args.notify.channel} target=${args.notify.target} body=${JSON.stringify(body)}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[human-task notify] delivery failed: ${msg}`);
  }
}

function buildResolveLink(workflowInstanceId: string, nodeId: string): string {
  const base = process.env.PUBLIC_BASE_URL ?? "";
  return `${base}/workflow-instances/${workflowInstanceId}#node-${nodeId}`;
}
