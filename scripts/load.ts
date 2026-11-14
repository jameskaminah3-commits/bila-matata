// scripts/load.ts
//
// Many customers at once: each opens a chat and sends a few messages through
// the public chat API, all at the same time, and the report says how long
// replies took (median, 95th percentile, slowest) and what failed.
//
//   npx tsx scripts/load.ts --base https://staging.example --business <test business> \
//     --origin https://<its site> [--customers 20] [--messages 3] [--text "What are your hours?"]
//
// Against staging or a local server only, with a test business: every
// message is a real reply and, on the real model, costs money. The chat
// limits per visitor and per business apply, so a big run from one machine
// sees "rate_limited" answers: that's the protection working, and it's
// reported separately from failures.

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const base = option("base", "http://127.0.0.1:5070").replace(/\/+$/, "");
const business = option("business", "");
const origin = option("origin", base);
const customers = Math.max(1, Math.min(500, Number(option("customers", "20"))));
const messages = Math.max(1, Math.min(20, Number(option("messages", "3"))));
const text = option("text", "Hello, what are your opening hours?");
if (!business) {
  console.error("Usage: npx tsx scripts/load.ts --business <id> [--base <url>] [--origin <site>] [--customers 20] [--messages 3] [--text <message>]");
  process.exit(2);
}

type Outcome = { ms: number; status: number; error?: string };
const outcomes: Outcome[] = [];

async function call(path: string, body: unknown, token?: string): Promise<{ status: number; json: any; ms: number }> {
  const started = performance.now();
  try {
    const response = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", origin, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    const json = await response.json().catch(() => ({}));
    return { status: response.status, json, ms: performance.now() - started };
  } catch (error) {
    return { status: 0, json: { error: (error as Error).message }, ms: performance.now() - started };
  }
}

async function customer(): Promise<void> {
  const opened = await call("/v1/sessions", { business });
  outcomes.push({ ms: opened.ms, status: opened.status, error: opened.status >= 400 || opened.status === 0 ? opened.json?.error : undefined });
  if (!opened.json?.token) return;
  for (let index = 0; index < messages; index += 1) {
    const reply = await call("/v1/chat", { message: text }, opened.json.token);
    outcomes.push({ ms: reply.ms, status: reply.status, error: reply.status >= 400 || reply.status === 0 ? reply.json?.error ?? `HTTP ${reply.status}` : undefined });
  }
}

const started = performance.now();
await Promise.all(Array.from({ length: customers }, () => customer()));
const seconds = (performance.now() - started) / 1000;

const sorted = outcomes.filter((outcome) => !outcome.error).map((outcome) => outcome.ms).sort((a, b) => a - b);
const at = (share: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] : 0);
const limited = outcomes.filter((outcome) => outcome.status === 429).length;
const failed = outcomes.filter((outcome) => outcome.error && outcome.status !== 429);
const reasons = new Map<string, number>();
for (const outcome of failed) reasons.set(outcome.error!, (reasons.get(outcome.error!) ?? 0) + 1);

const report = {
  customers,
  messages_each: messages,
  requests: outcomes.length,
  seconds: Number(seconds.toFixed(1)),
  per_second: Number((outcomes.length / seconds).toFixed(1)),
  ms: { median: Math.round(at(0.5)), p95: Math.round(at(0.95)), slowest: Math.round(sorted.at(-1) ?? 0) },
  rate_limited: limited,
  failed: failed.length,
  failures: Object.fromEntries(reasons),
};
console.log(JSON.stringify(report, null, 2));
process.exit(failed.length ? 1 : 0);
