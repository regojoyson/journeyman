/**
 * @file file-artifact-store.ts
 * IArtifactStore implementation that persists artifacts to the local filesystem.
 *
 * Artifacts are stored at:
 *   <rootDir>/<productId>/artifacts/<sessionId>/<key><ext>
 *
 * Content-type is used to select the file extension (e.g. "text/markdown" → ".md").
 * Every stored artifact receives a SHA-256 content hash for integrity verification
 * and deduplication. The returned ArtifactHandle uses a `file://` URI so downstream
 * consumers can locate and read the file without knowing the store's root directory.
 *
 * `putPath` copies an existing file into the store (used by phases that write a temp
 * report file). `put` accepts raw Buffer or string and writes it directly. `get` reads
 * the artifact back as a Buffer.
 */

import { createHash } from "node:crypto";
import { mkdirSync, statSync } from "node:fs";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import type { IArtifactStore, ArtifactHandle } from "@journeyman/core";

const EXT_BY_CT: Record<string, string> = {
  "text/markdown": ".md",
  "application/json": ".json",
  "text/plain": ".txt",
  "application/octet-stream": ".bin",
};
const CT_BY_EXT: Record<string, string> = {
  ".md": "text/markdown",
  ".json": "application/json",
  ".txt": "text/plain",
};

export type ProductIdResolver = (sessionId: string) => string | null;

export class FileArtifactStore implements IArtifactStore {
  constructor(
    private readonly rootDir: string,
    private readonly resolveProductId: ProductIdResolver,
  ) {}

  async put(
    sessionId: string,
    key: string,
    data: Buffer | string,
    opts: { contentType?: string; ext?: string } = {},
  ): Promise<ArtifactHandle> {
    const ext = opts.ext ?? (opts.contentType ? (EXT_BY_CT[opts.contentType] ?? ".bin") : ".bin");
    const { destPath } = this.prepare(sessionId, key, ext);
    const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    await writeFile(destPath, buf);
    return this.handleOf(sessionId, key, destPath, buf.length, opts.contentType);
  }

  async putPath(
    sessionId: string,
    key: string,
    srcPath: string,
    opts: { contentType?: string } = {},
  ): Promise<ArtifactHandle> {
    const ext = extname(srcPath) || ".bin";
    const { destPath } = this.prepare(sessionId, key, ext);
    await copyFile(srcPath, destPath);
    const size = statSync(destPath).size;
    return this.handleOf(sessionId, key, destPath, size, opts.contentType ?? CT_BY_EXT[ext]);
  }

  async get(handle: ArtifactHandle): Promise<Buffer> {
    return readFile(this.pathFor(handle));
  }

  pathFor(handle: ArtifactHandle): string {
    if (!handle.uri.startsWith("file://")) {
      throw new Error(`Not a file handle: ${handle.uri}`);
    }
    return handle.uri.slice("file://".length);
  }

  private prepare(sessionId: string, key: string, ext: string): { destPath: string; productId: string } {
    const productId = this.resolveProductId(sessionId);
    if (!productId) throw new Error(`FileArtifactStore: no product for session ${sessionId}`);
    const dir = join(this.rootDir, productId, "artifacts", sessionId);
    mkdirSync(dir, { recursive: true });
    return { destPath: join(dir, `${key}${ext}`), productId };
  }

  private async handleOf(
    sessionId: string, key: string, destPath: string, size: number, contentType?: string,
  ): Promise<ArtifactHandle> {
    const sha = createHash("sha256").update(await readFile(destPath)).digest("hex");
    return {
      kind: "artifact", sessionId, key, size, contentType,
      uri: `file://${resolve(destPath)}`,
      sha256: sha,
    };
  }
}
