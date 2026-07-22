import assert from "node:assert/strict";
import test from "node:test";
import { ToolBudgetGuard } from "../src/guard.js";
import { CONTEXT_MISSING_CODE, LIMIT_REACHED_CODE } from "../src/types.js";
test("admits calls 1 through 12 and blocks call 13", () => {
    const guard = new ToolBudgetGuard({ maxToolCallsPerRun: 12 });
    for (let count = 1; count <= 12; count += 1) {
        assert.deepEqual(guard.attempt("run-a"), { decision: "allow", admitted: count, limit: 12 });
    }
    assert.deepEqual(guard.attempt("run-a"), {
        decision: "block", code: LIMIT_REACHED_CODE, admitted: 12, limit: 12,
    });
    assert.deepEqual(guard.attempt("run-a"), {
        decision: "block", code: LIMIT_REACHED_CODE, admitted: 12, limit: 12,
    });
});
test("fails closed when runId is unavailable", () => {
    const guard = new ToolBudgetGuard({ maxToolCallsPerRun: 12 });
    assert.deepEqual(guard.attempt(undefined), {
        decision: "block", code: CONTEXT_MISSING_CODE, admitted: 0, limit: 12,
    });
});
test("parallel attempts cannot bypass synchronous admission", async () => {
    const guard = new ToolBudgetGuard({ maxToolCallsPerRun: 12 });
    const decisions = await Promise.all(Array.from({ length: 20 }, () => Promise.resolve().then(() => guard.attempt("parallel"))));
    assert.equal(decisions.filter((item) => item.decision === "allow").length, 12);
    assert.equal(decisions.filter((item) => item.decision === "block").length, 8);
    assert.deepEqual(guard.snapshot("parallel"), {
        admitted: 12, boundaryReached: true, revisionRequested: false,
        continuationRequested: false, continuationScheduled: false,
    });
});
test("captures continuation at the blocked tool boundary before finalize", () => {
    const guard = new ToolBudgetGuard({ maxToolCallsPerRun: 1 });
    assert.equal(guard.attempt("boundary-run").decision, "allow");
    assert.equal(guard.attempt("boundary-run").decision, "block");
    // before_agent_finalize is not guaranteed after a blocked tool call, so the
    // continuation must be capturable immediately at the boundary.
    assert.equal(guard.requestContinuation("boundary-run", "agent:main:test"), true);
    assert.deepEqual(guard.takeContinuation("boundary-run"), {
        runId: "boundary-run",
        sessionKey: "agent:main:test",
    });
});
test("a checkpointed boundary run schedules exactly one continuation", () => {
    const guard = new ToolBudgetGuard({ maxToolCallsPerRun: 1 });
    assert.equal(guard.attempt("run").decision, "allow");
    assert.equal(guard.attempt("run").decision, "block");
    assert.equal(guard.requestRevision("run"), true);
    assert.equal(guard.requestContinuation("run", "agent:main:test"), true);
    assert.deepEqual(guard.takeContinuation("run"), { runId: "run", sessionKey: "agent:main:test" });
    assert.equal(guard.takeContinuation("run"), undefined);
});
test("terminal failure does not suppress continuation after a boundary block", () => {
    const guard = new ToolBudgetGuard({ maxToolCallsPerRun: 1 });
    guard.attempt("run");
    guard.attempt("run");
    guard.requestContinuation("run", "agent:main:test");
    assert.deepEqual(guard.takeContinuation("run"), {
        runId: "run",
        sessionKey: "agent:main:test",
    });
});
test("run budgets are isolated and cleanup permits a new lifecycle", () => {
    const guard = new ToolBudgetGuard({ maxToolCallsPerRun: 1 });
    assert.equal(guard.attempt("a").decision, "allow");
    assert.equal(guard.attempt("b").decision, "allow");
    assert.equal(guard.attempt("a").decision, "block");
    assert.equal(guard.endRun("a"), true);
    assert.equal(guard.snapshot("a"), undefined);
    assert.equal(guard.attempt("a").decision, "allow");
});
test("revision is requested exactly once after boundary", () => {
    const guard = new ToolBudgetGuard({ maxToolCallsPerRun: 1 });
    guard.attempt("run-a");
    assert.equal(guard.requestRevision("run-a"), false);
    guard.attempt("run-a");
    assert.equal(guard.requestRevision("run-a"), true);
    assert.equal(guard.requestRevision("run-a"), false);
});
