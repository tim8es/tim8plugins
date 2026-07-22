import assert from "node:assert/strict";
import test from "node:test";
import { CHECKPOINT_IDEMPOTENCY_KEY, CHECKPOINT_INSTRUCTION, CONTINUATION_INSTRUCTION, formatLimitBlock, } from "../src/checkpoint.js";
test("checkpoint instruction requires result, blockers, reflection, and automatic continuation", () => {
    assert.match(CHECKPOINT_INSTRUCTION, /Intermediate result/);
    assert.match(CHECKPOINT_INSTRUCTION, /Blockers and uncertainty/);
    assert.match(CHECKPOINT_INSTRUCTION, /Current plan/);
    assert.match(CHECKPOINT_INSTRUCTION, /change the approach/);
    assert.match(CHECKPOINT_INSTRUCTION, /Do not ask the user to confirm/);
    assert.equal(CHECKPOINT_IDEMPOTENCY_KEY, "tool-checkpoint-guard:checkpoint:v1");
    assert.match(CONTINUATION_INSTRUCTION, /Automatically continue/);
    assert.match(CONTINUATION_INSTRUCTION, /no user reply is required/);
    assert.match(CONTINUATION_INSTRUCTION, /fresh tool-call budget/);
});
test("blocked tool result hard-stops retries before finalize", () => {
    const message = formatLimitBlock(12, 12);
    assert.match(message, /TOOL_CHECKPOINT_GUARD_LIMIT_REACHED: 12\/12/);
    assert.match(message, /HARD STOP/);
    assert.match(message, /next action must be a user-visible checkpoint reply/);
    assert.match(message, /every further tool call will be blocked/);
    assert.match(message, /continue automatically/);
});
