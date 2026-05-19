export type IssueRefProvider = "jira" | "github" | "monday" | "linear";

export interface ParsedIssueRef {
  provider: IssueRefProvider;
  rawId: string;
}

export function buildIssueRef(provider: IssueRefProvider, rawId: string | number): string {
  return `${provider}:${rawId}`;
}

export function parseIssueRef(ref: string): ParsedIssueRef {
  const colon = ref.indexOf(":");
  if (colon === -1) throw new Error(`Invalid issueRef: "${ref}"`);
  return { provider: ref.slice(0, colon) as IssueRefProvider, rawId: ref.slice(colon + 1) };
}
