#!/usr/bin/env node
// Enforces layer boundaries between @journeyman/* packages so the codebase
// stays deployable as 3 independent services (UI / API / Worker).
//
// Layers:
//   ui      — must NOT be imported from backend code (drags in React, browser-only deps).
//             Packages: @journeyman/flow-editor, @journeyman/steps (default entry),
//             @journeyman/run-viewer, @journeyman/runs-list, @journeyman/web.
//   backend — must NOT be imported from ui code (drags in node:*, db, secrets, providers).
//             Packages: @journeyman/api-server, @journeyman/orchestrator, @journeyman/coding-cli,
//             @journeyman/git-provider, @journeyman/github-api, @journeyman/ticket-provider,
//             @journeyman/notification-provider, @journeyman/secrets, @journeyman/migrations.
//   shared  — universal. Importable from anywhere.
//             Packages: @journeyman/core, @journeyman/identity.
//             Subpaths: @journeyman/steps/catalog (pure-data .meta.ts aggregator, no React).
//
// Allowed import directions:
//   ui      → ui, shared
//   backend → backend, shared
//   shared  → shared
//
// Anything else fails CI. Run via:  npm run check:boundaries

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(fileURLToPath(import.meta.url), "..", "..");

const PKG_LAYER = {
  "@journeyman/flow-editor": "ui",
  "@journeyman/run-viewer": "ui",
  "@journeyman/runs-list": "ui",
  "@journeyman/web": "ui",
  "@journeyman/steps": "ui",

  "@journeyman/api-server": "backend",
  "@journeyman/orchestrator": "backend",
  "@journeyman/coding-cli": "backend",
  "@journeyman/git-provider": "backend",
  "@journeyman/github-api": "backend",
  "@journeyman/ticket-provider": "backend",
  "@journeyman/notification-provider": "backend",
  "@journeyman/secrets": "backend",
  "@journeyman/migrations": "backend",

  "@journeyman/core": "shared",
  "@journeyman/identity": "shared",
};

// Subpath overrides — "@journeyman/steps/catalog" is shared (no React).
const SUBPATH_OVERRIDES = {
  "@journeyman/steps/catalog": "shared",
};

const ALLOWED = {
  ui:      new Set(["ui", "shared"]),
  backend: new Set(["backend", "shared"]),
  shared:  new Set(["shared"]),
};

const PKG_DIR_TO_NAME = {};
for (const [name] of Object.entries(PKG_LAYER)) {
  // packages/<basename> directory matches the part after the slash.
  PKG_DIR_TO_NAME[name.split("/")[1]] = name;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mts|cts)$/.test(entry)) out.push(full);
  }
  return out;
}

const IMPORT_RE = /(?:^|\s)(?:import\s+(?:[^"'`;]*?from\s+)?|export\s+[^"'`;]*?from\s+|import\s*\(\s*)["']([^"']+)["']/g;

function extractImports(source) {
  const out = new Set();
  let m;
  while ((m = IMPORT_RE.exec(source))) out.add(m[1]);
  return out;
}

function packageOf(filePath) {
  const rel = relative(join(REPO_ROOT, "packages"), filePath);
  const dir = rel.split("/")[0];
  return PKG_DIR_TO_NAME[dir];
}

function layerOfImport(spec) {
  if (!spec.startsWith("@journeyman/")) return null;
  if (SUBPATH_OVERRIDES[spec] != null) return SUBPATH_OVERRIDES[spec];
  // Strip subpath, keep "@journeyman/<pkg>"
  const parts = spec.split("/");
  const pkg = `${parts[0]}/${parts[1]}`;
  return PKG_LAYER[pkg] ?? null;
}

const violations = [];
for (const pkgDir of readdirSync(join(REPO_ROOT, "packages"))) {
  const srcDir = join(REPO_ROOT, "packages", pkgDir, "src");
  let stat;
  try { stat = statSync(srcDir); } catch { continue; }
  if (!stat.isDirectory()) continue;

  const fromPkg = PKG_DIR_TO_NAME[pkgDir];
  const fromLayer = fromPkg ? PKG_LAYER[fromPkg] : null;
  if (!fromLayer) continue;

  for (const file of walk(srcDir)) {
    const imports = extractImports(readFileSync(file, "utf8"));
    for (const spec of imports) {
      const toLayer = layerOfImport(spec);
      if (!toLayer) continue;
      if (!ALLOWED[fromLayer].has(toLayer)) {
        violations.push({
          file: relative(REPO_ROOT, file),
          spec,
          fromLayer,
          toLayer,
        });
      }
    }
  }
}

if (violations.length === 0) {
  console.log("✓ Layer boundaries clean across all packages.");
  process.exit(0);
}

console.error(`✕ ${violations.length} layer boundary violation(s):\n`);
for (const v of violations) {
  console.error(`  ${v.file}`);
  console.error(`    imports "${v.spec}"`);
  console.error(`    ${v.fromLayer} → ${v.toLayer}  (allowed: ${[...ALLOWED[v.fromLayer]].join(", ")})\n`);
}
console.error("Fix the imports above, or update PKG_LAYER in this script if a package was reclassified.");
process.exit(1);
