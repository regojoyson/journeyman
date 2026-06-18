import type { CreatePROptions, CreatePRResult } from "@journeyman/core";

export async function createPR(token: string, baseUrl: string, opts: CreatePROptions): Promise<CreatePRResult> {
  const host = baseUrl.replace(/\/+$/, "");
  const projectId = encodeURIComponent(`${opts.owner}/${opts.repo}`);
  try {
    const res = await fetch(`${host}/api/v4/projects/${projectId}/merge_requests`, {
      method: "POST",
      headers: { "PRIVATE-TOKEN": token, "Content-Type": "application/json" },
      body: JSON.stringify({
        source_branch: opts.sourceBranch,
        target_branch: opts.targetBranch,
        title: opts.title,
        description: opts.body ?? "",
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { id: "", url: "", number: 0, error: `GitLab MR create failed: ${res.status} ${text}`, sessionId: opts.sessionId };
    }
    const mr = (await res.json()) as { id: number; iid: number; web_url: string };
    return { id: String(mr.id), url: mr.web_url, number: mr.iid, sessionId: opts.sessionId };
  } catch (err: any) {
    return { id: "", url: "", number: 0, error: `GitLab MR create failed: ${err?.message ?? String(err)}`, sessionId: opts.sessionId };
  }
}
