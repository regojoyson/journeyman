/** System-prompt snippet that tells the agent its workspace boundary. */
export function confinementSystemPrompt(root: string): string {
  return [
    `WORKSPACE BOUNDARY: Your workspace is rooted at ${root}.`,
    "All files you read, write, search, or operate on live under this directory.",
    "Do not access paths outside it — file and search tools will refuse out-of-workspace paths.",
    `Use relative paths or absolute paths under ${root}.`,
  ].join(" ");
}
