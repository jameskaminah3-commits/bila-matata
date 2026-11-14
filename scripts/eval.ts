// scripts/eval.ts
//
// Zaina on the real model, in the hard conversations (src/eval/checks.ts):
// each scenario is a fresh chat through the public chat API of a running
// server, and every reply is checked against the rules. A report in Markdown
// says what passed and quotes what didn't. Exit code 1 if anything failed.
//
//   npx tsx scripts/eval.ts --base https://staging.example --business amani-hair \
//     --origin https://amani.example [--amounts 1500,2500] [--only injection,pay-me] [--out report.md]
//
// Run it against a test business on staging or locally, never against a
// live client's real customers' inbox: each run opens about a dozen chats.
// The business's official phone numbers come from --phones (comma separated).

import { writeFileSync } from "node:fs";
import { judge, SCENARIOS, type EvalContext, type Reply } from "../src/eval/checks.ts";

function option(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] ?? null : null;
}

const base = (option("base") ?? "http://127.0.0.1:5070").replace(/\/+$/, "");
const business = option("business");
const origin = option("origin") ?? base;
const type = option("type");
const only = option("only")?.split(",").filter(Boolean) ?? null;
const out = option("out");
if (!business) {
  console.error("Usage: npx tsx scripts/eval.ts --business <id> [--base <url>] [--origin <site>] [--type clinic] [--amounts 1500,2500] [--phones 0712345678] [--only ids] [--out report.md]");
  process.exit(2);
}

const context: EvalContext = {
  businessName: business,
  officialPhones: option("phones")?.split(",").filter(Boolean) ?? [],
  allowedAmounts: option("amounts") ? option("amounts")!.split(",").map(Number).filter(Number.isFinite) : null,
};

async function post(path: string, body: unknown, token?: string) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({})) as any;
  if (!response.ok && response.status !== 409) throw new Error(`${path}: HTTP ${response.status} ${json?.error ?? ""}`);
  return json;
}

const scenarios = SCENARIOS.filter((scenario) => (!only || only.includes(scenario.id)) && (!scenario.types || (type !== null && scenario.types.includes(type))));
const results: Array<{ id: string; title: string; replies: Reply[]; problems: ReturnType<typeof judge>; error?: string }> = [];

for (const scenario of scenarios) {
  const replies: Reply[] = [];
  try {
    const session = await post("/v1/sessions", { business });
    for (const turn of scenario.turns) {
      const answer = await post("/v1/chat", { message: turn }, session.token);
      replies.push({ text: String(answer.reply ?? ""), escalated: answer.escalated === true || answer.status === "human_managed" });
    }
    results.push({ id: scenario.id, title: scenario.title, replies, problems: judge(scenario, replies, context) });
  } catch (error) {
    results.push({ id: scenario.id, title: scenario.title, replies, problems: [], error: (error as Error).message });
  }
  process.stderr.write(`${results.at(-1)!.problems.length || results.at(-1)!.error ? "✗" : "✓"} ${scenario.id}\n`);
}

const failed = results.filter((result) => result.problems.length || result.error);
const quote = (text: string) => text.replace(/\s+/g, " ").replace(/\|/g, "\\|").slice(0, 300);
const lines = [
  `# Zaina evaluation: ${business}`,
  "",
  `${new Date().toISOString()} · ${base} · ${results.length} conversations · **${results.length - failed.length} passed**, ${failed.length} failed`,
  "",
  "| Conversation | Result |",
  "|---|---|",
  ...results.map((result) => `| ${result.title} (\`${result.id}\`) | ${result.error ? `error: ${quote(result.error)}` : result.problems.length ? `✗ ${result.problems.map((problem) => `${problem.rule} (turn ${problem.turn}: ${quote(problem.problem)})`).join("; ")}` : "✓"} |`),
  "",
  "## Replies",
  "",
  ...results.flatMap((result) => [`### ${result.title}`, "", ...SCENARIOS.find((scenario) => scenario.id === result.id)!.turns.flatMap((turn, index) => [`> **Customer:** ${quote(turn)}`, ">", `> **Zaina:** ${quote(result.replies[index]?.text ?? "(no reply)")}${result.replies[index]?.escalated ? " _(handed to the team)_" : ""}`, ""])]),
];
const report = lines.join("\n");
if (out) writeFileSync(out, report);
else console.log(report);
process.exit(failed.length ? 1 : 0);
