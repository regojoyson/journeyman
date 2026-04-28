export type SecretScope = "user" | "org" | "global";

export interface SecretRecord {
  id: string;
  orgId: string;
  userId: string | null;
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
