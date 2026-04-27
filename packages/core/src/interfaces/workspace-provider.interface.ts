export interface IWorkspace {
  /** Absolute path on whatever filesystem the worker can read/write. */
  readonly path: string;
  destroy(): Promise<void>;
}

export interface IWorkspaceProvider {
  create(opts: {
    runId: string;
    nodeId: string;
    /** Optional: lets the provider scope per-user (Docker user-id, k8s namespace, etc.). */
    userId?: string | null;
  }): Promise<IWorkspace>;
}
