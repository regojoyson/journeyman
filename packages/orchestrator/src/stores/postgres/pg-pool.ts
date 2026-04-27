import { Pool } from "pg";

export interface PgConfig {
  connectionString: string;
  max?: number;
}

export function createPool(cfg: PgConfig): Pool {
  return new Pool({
    connectionString: cfg.connectionString,
    max: cfg.max ?? 10,
  });
}
