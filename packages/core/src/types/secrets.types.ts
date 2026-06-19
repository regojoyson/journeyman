export type SecretScope = "workspace" | "org";

export interface SecretRecord {
  id: string;
  orgId: string;
  workspaceId: string | null;
  name: string;
  description: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export class MissingSecretsError extends Error {
  constructor(public readonly missing: string[]) {
    super(`Missing required secrets: ${missing.join(", ")}`);
    this.name = "MissingSecretsError";
  }
}
