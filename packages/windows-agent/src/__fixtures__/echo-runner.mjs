import { readFileSync } from "node:fs";
const input = readFileSync(0, "utf8");
process.stderr.write(JSON.stringify({ line: "starting", meta: { phase: "init" } }) + "\n");
const req = JSON.parse(input || "{}");
process.stderr.write(JSON.stringify({ line: `op=${req.op}` }) + "\n");
process.stdout.write(JSON.stringify({ ok: true, structured: { op: req.op } }));
