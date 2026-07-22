import { type GuardConfig, type GuardDecision, type RunSnapshot } from "./types.js";
/**
 * In-memory, run-scoped admission gate. attempt() has no await points: calls
 * arriving in one JS event loop reserve slots serially, including parallel batches.
 */
export declare class ToolBudgetGuard {
    private readonly config;
    private readonly states;
    constructor(config: GuardConfig);
    attempt(runId?: string): GuardDecision;
    checkpointPending(runId?: string): boolean;
    /** Returns true once per boundary run, making finalize retries bounded/idempotent. */
    requestRevision(runId?: string): boolean;
    endRun(runId?: string): boolean;
    snapshot(runId?: string): RunSnapshot | undefined;
}
