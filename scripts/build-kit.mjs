#!/usr/bin/env node
// Build the Journeyman "kit" images and PUSH them to a configurable registry.
// Captures each pushed manifest digest and writes <out>/kit.json. No tars.
//
// Required env:
//   JOURNEYMAN_REGISTRY            e.g. localhost:5000 | ghcr.io/acme | registry.gitlab.com/acme/jm
// Optional env:
//   JOURNEYMAN_BASE_DIR           data root (kit.json goes under <root>/kit)
//   KIT_OUT_DIR                   explicit output dir (wins over base/kit)
// Build + push use the Docker CLI (your active `docker context`). For a private
// registry, run `docker login <registry>` first.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { config as loadDotenv } from "dotenv";
import { Pool } from "pg";
import { upsertKitImage } from "@journeyman/sandbox";

// ENV_FILE selects the dotenv file (default .env for dev; compose-up.sh sets
// .env.production for the deploy path).
loadDotenv({ path: process.env.ENV_FILE ?? ".env" });

const registry = process.env.JOURNEYMAN_REGISTRY;
if (!registry) {
  console.error("ERROR: JOURNEYMAN_REGISTRY is required (e.g. localhost:5000 or ghcr.io/acme)");
  process.exit(1);
}

const repoRoot = process.cwd();
const base = process.env.JOURNEYMAN_BASE_DIR ?? join(homedir(), ".journeyman");
const argOut = (() => { const i = process.argv.indexOf("--out"); return i !== -1 ? process.argv[i + 1] : undefined; })();
const outDir = argOut ?? process.env.KIT_OUT_DIR ?? join(base, "kit");

const targets = [
  { role: "bundle", repo: `${registry}/runner-bundle`, tag: `${registry}/runner-bundle:dev`, dockerfile: "docker/runner-bundle.Dockerfile" },
  { role: "base",   repo: `${registry}/runner-base`,   tag: `${registry}/runner-base:dev`,   dockerfile: "docker/runner-base.Dockerfile" },
];

function run(cmd, args) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { stdio: "inherit", cwd: repoRoot });
}

mkdirSync(outDir, { recursive: true });
const kit = {};

// Build + push via the Docker CLI, which resolves the daemon from the active
// `docker context` (no DOCKER_HOST/socket guessing). The pushed manifest digest
// is read back from RepoDigests so kit refs are pinned by digest.
for (const t of targets) {
  console.log(`\n=== build ${t.tag} (${t.dockerfile}) ===`);
  run("docker", ["build", "-f", t.dockerfile, "-t", t.tag, "."]);
  console.log(`\n=== push ${t.tag} ===`);
  run("docker", ["push", t.tag]);
  const repoDigest = execFileSync(
    "docker",
    ["inspect", "--format", "{{index .RepoDigests 0}}", t.tag],
    { encoding: "utf8" },
  ).trim();
  if (!repoDigest) {
    console.error(`ERROR: no RepoDigest for ${t.tag} after push`);
    process.exit(1);
  }
  console.log(`pushed ${t.role}: ${repoDigest}`);
  kit[t.role] = repoDigest;
}

const kitJsonPath = join(outDir, "kit.json");
writeFileSync(kitJsonPath, JSON.stringify(kit, null, 2) + "\n");
console.log(`\n✓ Kit pushed. Digests written to ${kitJsonPath}`);
console.log(`  base:   ${kit.base}`);
console.log(`  bundle: ${kit.bundle}`);

// Record the digests in kit_images so workers pick them up. Best-effort: this
// works when the DB is reachable (e.g. local dev with infra:up). Under compose:up
// the DB isn't up yet when this runs, so compose-up.sh calls register-kit later.
if (process.env.DATABASE_URL) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await upsertKitImage(pool, "base", kit.base);
    await upsertKitImage(pool, "bundle", kit.bundle);
    console.log(`✓ registered digests in kit_images`);
  } catch (err) {
    console.warn(`! could not register in kit_images (${err.message})`);
    console.warn(`  run 'npm run register-kit' once the DB is up.`);
  } finally {
    await pool.end();
  }
} else {
  console.log(`\nNo DATABASE_URL set — run 'npm run register-kit' to record these in kit_images.`);
}
