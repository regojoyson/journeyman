#!/usr/bin/env node
// Fails when UI code uses hardcoded colors that bypass the theme tokens.
// Themed code must use rgb(var(--color-*) / a) or the semantic Tailwind names.
// See docs/superpowers/specs/2026-06-16-light-theme-token-migration-design.md
//
// Usage:
//   node scripts/check-theme-colors.mjs                 # scan all UI packages
//   node scripts/check-theme-colors.mjs packages/web    # scan one path

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = join(fileURLToPath(import.meta.url), "..", "..");

// Files whose hardcoded colors are intentional and exempt.
const ALLOWED_FILES = new Set([
  "packages/theme/src/tokens.css",                    // the token definitions themselves
  "packages/flow-editor/src/palette/built-in-categories.ts", // fixed category legend palette
  "packages/web/src/flow-editor-integration/useCustomStepPaletteEntries.ts", // fixed custom-step legend palette
]);

const HEX_RE = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
// Tailwind utilities on non-themeable palettes / out-of-remap slate shades.
// Note: `text-white` is intentionally NOT flagged — white is a theme-safe
// foreground on colored controls. `shadow-*` colors are color-agnostic and
// likewise excluded. Real bugs are non-themeable backgrounds/borders/fills and
// non-white text colors that won't flip between themes.
const PALETTE = "white|black|gray|zinc|neutral|stone|slate-(?:50|950)";
// Dark semantic tints (e.g. bg-rose-950, border-emerald-900) read fine in dark
// but render as muddy dark blocks in light. Backgrounds/borders/rings on these
// must use the themed semantic tokens (bg-danger/10, border-success/25, …).
const DARK_TINT =
  "(?:indigo|violet|purple|fuchsia|emerald|green|teal|sky|blue|cyan|amber|orange|yellow|red|rose|pink)-(?:900|950)";
const CLASS_RE = new RegExp(
  `\\b(?:(?:bg|border|ring|from|to|via|fill|stroke|divide|placeholder|outline|decoration)-(?:${PALETTE})` +
    `|text-(?:black|gray|zinc|neutral|stone|slate-(?:50|950))` +
    `|(?:bg|border|ring|divide|from|to|via|fill|stroke)-${DARK_TINT})\\b`,
  "g",
);

const ALLOW_MARK = /theme-colors-allow/;

export function findViolations(relPath, content) {
  if (ALLOWED_FILES.has(relPath)) return [];
  const violations = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (ALLOW_MARK.test(line)) continue; // explicit per-line exemption
    for (const m of line.matchAll(HEX_RE)) violations.push(`${relPath}:${i + 1}  ${m[0]}`);
    for (const m of line.matchAll(CLASS_RE)) violations.push(`${relPath}:${i + 1}  ${m[0]}`);
  }
  return violations;
}

const UI_PKGS = ["flow-editor", "run-viewer", "runs-list", "web", "theme"];
const EXTS = new Set([".css", ".ts", ".tsx"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".turbo"]);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) yield* walk(full);
    } else if (EXTS.has(extname(entry)) && !basename(entry).endsWith(".test.ts")) {
      yield full;
    }
  }
}

function roots(argv) {
  if (argv.length) return argv.map((p) => join(REPO_ROOT, p));
  return UI_PKGS.map((p) => join(REPO_ROOT, "packages", p, "src"));
}

// Run the scan only when invoked directly (not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let all = [];
  for (const root of roots(process.argv.slice(2))) {
    for (const file of walk(root)) {
      const rel = relative(REPO_ROOT, file);
      all = all.concat(findViolations(rel, readFileSync(file, "utf8")));
    }
  }

  if (all.length) {
    console.error(`✗ ${all.length} hardcoded color(s) bypass theme tokens:\n`);
    for (const v of all) console.error("  " + v);
    console.error(
      "\nReplace with rgb(var(--color-*) / a) or a semantic Tailwind name." +
        "\nFor a legitimate exception add a `theme-colors-allow` comment on the line.",
    );
    process.exit(1);
  } else {
    console.log("✓ No hardcoded colors bypass theme tokens.");
  }
}
