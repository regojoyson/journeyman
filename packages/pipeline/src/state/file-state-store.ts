import { mkdirSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { IStateStore, PipelineRun } from "@journeyman/core";

/** State stored as <rootDir>/<productId>/state/<sessionId>.json. */
export class FileStateStore implements IStateStore {
  constructor(private readonly rootDir: string) {
    mkdirSync(rootDir, { recursive: true });
  }

  private dirFor(productId: string): string {
    const d = join(this.rootDir, productId, "state");
    mkdirSync(d, { recursive: true });
    return d;
  }

  async load(sessionId: string): Promise<PipelineRun | null> {
    for (const pid of this.listProducts()) {
      const p = join(this.dirFor(pid), `${sessionId}.json`);
      if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
    }
    return null;
  }

  async save(run: PipelineRun): Promise<void> {
    const dir = this.dirFor(run.productId);
    const final = join(dir, `${run.sessionId}.json`);
    const tmp = `${final}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, JSON.stringify(run, null, 2), "utf8");
    await rename(tmp, final);
  }

  async findByTicket(productId: string, ticketKey: string): Promise<PipelineRun[]> {
    return this.scanProduct(productId)
      .filter(r => r.ticketKey === ticketKey)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async findActiveForTicket(productId: string, ticketKey: string): Promise<PipelineRun | null> {
    const active = new Set<PipelineRun["status"]>(["queued", "running", "blocked", "cancelling"]);
    return this.scanProduct(productId)
      .filter(r => r.ticketKey === ticketKey && active.has(r.status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  }

  async find(q: { productId?: string; status?: PipelineRun["status"]; limit?: number }): Promise<PipelineRun[]> {
    const ps = q.productId ? [q.productId] : this.listProducts();
    let rs = ps.flatMap(p => this.scanProduct(p));
    if (q.status) rs = rs.filter(r => r.status === q.status);
    rs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (q.limit) rs = rs.slice(0, q.limit);
    return rs;
  }

  private listProducts(): string[] {
    if (!existsSync(this.rootDir)) return [];
    return readdirSync(this.rootDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  }

  private scanProduct(productId: string): PipelineRun[] {
    const d = join(this.rootDir, productId, "state");
    if (!existsSync(d)) return [];
    return readdirSync(d)
      .filter(f => f.endsWith(".json") && !f.includes(".tmp-"))
      .map(f => JSON.parse(readFileSync(join(d, f), "utf8")) as PipelineRun);
  }
}
