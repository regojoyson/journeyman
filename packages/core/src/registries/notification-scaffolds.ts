/**
 * Plain-text starter templates for the workflow send-message step. Unlike agent
 * notification templates, the step has NO {placeholder} renderer — dynamic values
 * are inserted by the user via the flow editor's @-mention bindings. So these
 * scaffolds are deliberately plain prose the user fills in / binds afterwards.
 */
export interface NotificationScaffold {
  id: string;
  label: string;
  subject: string;
  body: string;
}

export const NOTIFICATION_SCAFFOLDS: NotificationScaffold[] = [
  {
    id: "alert",
    label: "Generic alert",
    subject: "Workflow notification",
    body: "Heads up — an update from this workflow. Use @ to insert a value from an earlier step.",
  },
  {
    id: "deploy",
    label: "Deployment notice",
    subject: "Deployment update",
    body: "A deployment has finished. Review the details, or @-reference the deploy step output here.",
  },
  {
    id: "build",
    label: "Build / CI status",
    subject: "Build status",
    body: "The build completed. Insert the result with @ to reference an upstream step.",
  },
  {
    id: "pr",
    label: "Pull request opened",
    subject: "Pull request opened",
    body: "A pull request was opened. Paste the link or @-reference the PR step's output.",
  },
];
