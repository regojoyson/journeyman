import type { Shape } from "./shape.types.ts";

export const IssueShape: Shape = {
  type: "object",
  named: "Issue",
  fields: {
    ref:           { type: "string", description: "Provider-native identifier (e.g. PROJ-123)" },
    id:            { type: "string", description: "Provider-native id" },
    title:         { type: "string" },
    description:   { type: "string" },
    status:        { type: "string" },
    assignee:      { type: "string" },
    labels:        { type: "array", items: { type: "string" } },
    url:           { type: "string" },
    priority:      { type: "string" },
    issueType:     { type: "string" },
    reporter:      { type: "string" },
    createdAt:     { type: "string" },
    updatedAt:     { type: "string" },
  },
};

export const RepoShape: Shape = {
  type: "object",
  named: "Repo",
  fields: {
    repoDir:   { type: "string", description: "Local checkout directory" },
    branch:    { type: "string", description: "Current branch in this repo" },
    newBranch: { type: "string", description: "The feature branch created on this repo (if any)" },
    owner:     { type: "string", description: "GitHub/GitLab owner or org" },
    repoName:  { type: "string", description: "Bare repository name (e.g. 'api')" },
    url:       { type: "string", description: "Clone URL" },
    folderName:{ type: "string", description: "Folder basename inside the workspace" },
  },
};

export const PullRequestShape: Shape = {
  type: "object",
  named: "PullRequest",
  fields: {
    id:     { type: "string" },
    number: { type: "number" },
    url:    { type: "string" },
    title:  { type: "string" },
    state:  { type: "string" },
    head:   { type: "string" },
    base:   { type: "string" },
  },
};

export const WorkspaceShape: Shape = {
  type: "object",
  named: "Workspace",
  fields: {
    folderName: { type: "string" },
    repoDir:    { type: "string" },
  },
};

export const NAMED_SHAPES: Record<string, Shape> = {
  Issue: IssueShape,
  Repo: RepoShape,
  PullRequest: PullRequestShape,
  Workspace: WorkspaceShape,
};

/**
 * Recursively resolve "ref" shapes against the registry. Throws on unknown
 * names. Idempotent on already-resolved shapes.
 */
export function resolveShape(s: Shape): Shape {
  if (s.type === "ref") {
    const target = NAMED_SHAPES[s.name];
    if (!target) throw new Error(`Unknown named shape: ${s.name}`);
    return resolveShape(target);
  }
  if (s.type === "object") {
    const fields: Record<string, Shape> = {};
    for (const [k, v] of Object.entries(s.fields)) fields[k] = resolveShape(v);
    return { ...s, fields };
  }
  if (s.type === "array") {
    return { ...s, items: resolveShape(s.items) };
  }
  return s;
}

/**
 * Structural equality after resolution. Used by ref-shape validator to compare
 * the producer's leaf shape to the consumer's declared input shape.
 */
export function shapesEqual(a: Shape, b: Shape): boolean {
  const ra = resolveShape(a);
  const rb = resolveShape(b);
  if (ra.type !== rb.type) return false;
  if (ra.type === "object" && rb.type === "object") {
    const ak = Object.keys(ra.fields).sort();
    const bk = Object.keys(rb.fields).sort();
    if (ak.length !== bk.length) return false;
    for (let i = 0; i < ak.length; i++) {
      if (ak[i] !== bk[i]) return false;
      if (!shapesEqual(ra.fields[ak[i]], rb.fields[bk[i]])) return false;
    }
    return true;
  }
  if (ra.type === "array" && rb.type === "array") {
    return shapesEqual(ra.items, rb.items);
  }
  return true; // scalars of equal `type`
}

/**
 * Walk a dotted path against a shape, resolving "ref" along the way.
 * Returns null if any segment doesn't resolve. Empty path returns the input.
 */
export function shapeAtPath(root: Shape, path: string[]): Shape | null {
  let cur: Shape = resolveShape(root);
  for (const seg of path) {
    if (cur.type === "object") {
      const next = cur.fields[seg];
      if (!next) return null;
      cur = resolveShape(next);
    } else if (cur.type === "array") {
      // Convention: array path uses "[item]" or numeric index; both resolve to items.
      cur = resolveShape(cur.items);
    } else {
      return null;
    }
  }
  return cur;
}
