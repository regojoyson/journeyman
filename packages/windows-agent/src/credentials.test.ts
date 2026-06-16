import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadServerCredentials } from "./credentials.ts";

const certDir = fileURLToPath(new URL("../spike/certs", import.meta.url));

describe("loadServerCredentials", () => {
  it.skipIf(!existsSync(join(certDir, "server.pem")))("builds mTLS server credentials from a certDir", () => {
    const creds = loadServerCredentials(certDir);
    expect(creds).toBeDefined();
  });

  it("throws a clear error when a cert file is missing", () => {
    expect(() => loadServerCredentials("/nope")).toThrow(/cert/i);
  });
});
