import assert from "node:assert/strict";
import test from "node:test";
import { ContinuationLimiter, continuationTag } from "../src/continuation.js";

test("continuation tags contain no reserved cron delimiters", () => {
  const tag = continuationTag("run:agent/main:123");
  assert.equal(tag, "tool-checkpoint-guard-continue-run-agent-main-123");
  assert.doesNotMatch(tag, /[:/\\]/);
});

test("automatic continuation chains are bounded and resettable", () => {
  const limiter = new ContinuationLimiter(2);
  assert.equal(limiter.reserve("session"), 1);
  assert.equal(limiter.reserve("session"), 2);
  assert.equal(limiter.reserve("session"), undefined);
  limiter.reset("session");
  assert.equal(limiter.reserve("session"), 1);
});
