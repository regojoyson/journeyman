#!/usr/bin/env node
// Build the Journeyman "kit" images and `docker save` them to tar files.
// This is the ONLY place the kit is built. The worker never builds it — it loads
// these tars onto whatever daemon it targets (no registry, no source at runtime).
//
// Usage:
//   npm run build:kit                 # → $JOURNEYMAN_BASE_DIR/kit (or ~/.journeyman/kit)
//   npm run build:kit -- --out ./dist/kit
//
// Env overrides:
//   JOURNEYMAN_BASE_DIR   data root (kit goes under <root>/kit)
//   KIT_OUT_DIR           explicit output dir (wins over base/kit)
//   JOURNEYMAN_RUNNER_BUNDLE / JOURNEYMAN_RUNNER_IMAGE   image tags to build
//   DOCKER_HOST           which daemon to build on (e.g. unix:///Users/you/.rd/docker.sock)
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { config as loadDotenv } from "dotenv";

// Load .env so JOURNEYMAN_BASE_DIR (and overrides) match what the worker uses.
loadDotenv();

const repoRoot = process.cwd();
const base = process.env.JOURNEYMAN_BASE_DIR ?? join(homedir(), ".journeyman");
const argOut = (() => {
  const i = process.argv.indexOf("--out");
  return i !== -1 ? process.argv[i + 1] : undefined;
})();
const outDir = argOut ?? process.env.KIT_OUT_DIR ?? join(base, "kit");

const BUNDLE = process.env.JOURNEYMAN_RUNNER_BUNDLE ?? "journeyman/runner-bundle:dev";
const BASE_IMG = process.env.JOURNEYMAN_RUNNER_IMAGE ?? "journeyman/runner-base:dev";

const targets = [
  { name: BUNDLE, dockerfile: "docker/runner-bundle.Dockerfile", tar: "runner-bundle.tar" },
  { name: BASE_IMG, dockerfile: "docker/runner-base.Dockerfile", tar: "runner-base.tar" },
];

function run(cmd, args) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { stdio: "inherit", cwd: repoRoot });
}

mkdirSync(outDir, { recursive: true });
console.log(`Building kit → ${outDir}\n`);

for (const t of targets) {
  console.log(`\n=== build ${t.name} (${t.dockerfile}) ===`);
  run("docker", ["build", "-f", t.dockerfile, "-t", t.name, "."]);
  const tarPath = join(outDir, t.tar);
  console.log(`\n=== save ${t.name} → ${tarPath} ===`);
  run("docker", ["save", t.name, "-o", tarPath]);
}

console.log(`\n✓ Kit ready in ${outDir}`);
console.log("  - runner-bundle.tar (graft kit)");
console.log("  - runner-base.tar   (default box)");
