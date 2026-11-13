// Near its daily budget a business is answered by the cheaper model.

import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../../src/config.ts";
import { modelForUsage } from "../../src/gateway/spend-cap.ts";

const models = { primary: "gemini-main", saver: "gemini-3.5-flash-lite", saverAtShare: 0.8 };
const used = (tokens: number) => ({ inputTokens: tokens, outputTokens: 0, turns: 1 });

test("the cheaper model takes over from 80% of the daily budget", () => {
  assert.equal(modelForUsage(used(0), 1000, models), "gemini-main");
  assert.equal(modelForUsage(used(799), 1000, models), "gemini-main");
  assert.equal(modelForUsage(used(800), 1000, models), "gemini-3.5-flash-lite");
  assert.equal(modelForUsage({ inputTokens: 500, outputTokens: 400, turns: 2 }, 1000, models), "gemini-3.5-flash-lite", "input and output both count");
});

test("no switch without a budget, without a saver, or when the saver is the main model", () => {
  assert.equal(modelForUsage(used(10_000_000), null, models), "gemini-main");
  assert.equal(modelForUsage(used(900), 1000, { ...models, saver: null }), "gemini-main");
  assert.equal(modelForUsage(used(900), 1000, { ...models, primary: "gemini-3.5-flash-lite" }), "gemini-3.5-flash-lite");
});

test("settings: the lite model at 80% by default; another model, another share, or off", () => {
  const base = { SESSION_TOKEN_SECRET: "x".repeat(40), GEMINI_API_KEY: "k", PLATFORM_DATABASE_URL: "postgres://u:p@127.0.0.1:5432/db" } as NodeJS.ProcessEnv;
  const plain = loadConfig(base);
  assert.equal(plain.saverModel, "gemini-3.5-flash-lite");
  assert.equal(plain.saverAtPercent, 80);
  const custom = loadConfig({ ...base, ZAINA_SAVER_MODEL: "gemini-other-lite", ZAINA_SAVER_AT_PERCENT: "60" });
  assert.equal(custom.saverModel, "gemini-other-lite");
  assert.equal(custom.saverAtPercent, 60);
  assert.equal(loadConfig({ ...base, ZAINA_SAVER_MODEL: "off" }).saverModel, null);
  assert.throws(() => loadConfig({ ...base, ZAINA_SAVER_AT_PERCENT: "0" }), /1 to 100/);
  assert.throws(() => loadConfig({ ...base, ZAINA_SAVER_AT_PERCENT: "150" }), /1 to 100/);
});
