import assert from "node:assert/strict";
import { test } from "node:test";
import { backgroundCheck, jobFinished, jobStarted, repliesState, resetJobs } from "../../src/ops/health.ts";

test("replies: a handful of failures among few chats isn't an alarm; a high share is", () => {
  assert.equal(repliesState(0, 0), "ok");
  assert.equal(repliesState(3, 3), "ok", "too few to judge");
  assert.equal(repliesState(20, 2), "ok");
  assert.equal(repliesState(20, 5), "degraded");
  assert.equal(repliesState(20, 10), "down");
});

test("background jobs: failing three times running, or not finishing, is reported", () => {
  resetJobs();
  jobStarted("calendars", 60_000);
  jobFinished("calendars", null);
  assert.equal(backgroundCheck().state, "ok");
  for (let index = 0; index < 3; index += 1) {
    jobStarted("calendars", 60_000);
    jobFinished("calendars", new Error("Google said no"));
  }
  const failing = backgroundCheck();
  assert.equal(failing.state, "degraded");
  assert.match(failing.detail, /calendars failed 3 times running \(Google said no\)/);
  jobStarted("calendars", 60_000);
  jobFinished("calendars", null);
  assert.equal(backgroundCheck().state, "ok", "one good run clears it");
  // Not finished for far longer than its interval (and the server has been up that long).
  assert.equal(backgroundCheck(Date.now() + 10 * 60_000).state, "degraded");
  resetJobs();
});
