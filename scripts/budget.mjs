// scripts/budget.mjs
//
// The performance budget: how much a customer's phone downloads for the chat,
// and a team member's for the dashboard, measured gzipped from the build.
// Run after `npm run build` (or `npm run build:web`); exits 1 when anything
// is over, so a heavier change is a decision, not an accident.
//
//   npm run budget

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "dist", "public");
const KB = 1024;

// Customers first: the chat must start fast on a slow connection.
const BUDGETS = [
  { file: "widget.js", max: 10 * KB, who: "every visitor to a client's site" },
  { file: "console/app.js", max: 150 * KB, who: "the dashboard, first load" },
  { file: "console/app.css", max: 14 * KB, who: "the dashboard, first load" },
  { file: "console/sw.js", max: 2 * KB, who: "the dashboard's offline worker" },
  { file: "console/pdf-reader.js", max: 180 * KB, who: "only when a PDF is imported", lazy: true },
];

let over = 0;
const rows = [];
for (const budget of BUDGETS) {
  const file = path.join(ROOT, budget.file);
  if (!existsSync(file)) {
    console.error(`Missing ${budget.file}: run npm run build first.`);
    process.exit(2);
  }
  const size = gzipSync(readFileSync(file), { level: 9 }).byteLength;
  const ok = size <= budget.max;
  if (!ok) over += 1;
  rows.push(`${ok ? "✓" : "✗"} ${budget.file.padEnd(24)} ${(size / KB).toFixed(1).padStart(6)} KB of ${(budget.max / KB).toFixed(0).padStart(3)} KB  ${budget.who}`);
}

// The PDF reader must stay out of the dashboard's first load.
const index = readFileSync(path.join(ROOT, "console", "index.html"), "utf8");
if (/pdf-reader/.test(index)) {
  over += 1;
  rows.push("✗ console/index.html loads pdf-reader.js up front: it must load only when a PDF is imported");
}

console.log(rows.join("\n"));
if (over) {
  console.error(`\n${over} over budget. Make it smaller, or raise the budget in scripts/budget.mjs on purpose.`);
  process.exit(1);
}
console.log("\nAll within budget.");
