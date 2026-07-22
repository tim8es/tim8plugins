import { CONTEXT_MISSING_CODE, LIMIT_REACHED_CODE, } from "./types.js";
/**
 * In-memory, run-scoped admission gate. attempt() has no await points: calls
 * arriving in one JS event loop reserve slots serially, including parallel batches.
 */
export class ToolBudgetGuard {
    config;
    states = new Map();
    constructor(config) {
        this.config = config;
        if (!Number.isInteger(config.maxToolCallsPerRun) || config.maxToolCallsPerRun < 1 || config.maxToolCallsPerRun > 100) {
            throw new Error("maxToolCallsPerRun must be an integer from 1 through 100");
        }
    }
    attempt(runId) {
        const limit = this.config.maxToolCallsPerRun;
        if (!runId)
            return { decision: "block", code: CONTEXT_MISSING_CODE, admitted: 0, limit };
        const state = this.states.get(runId) ?? {
            admitted: 0,
            boundaryReached: false,
            revisionRequested: false,
            continuationRequested: false,
            continuationScheduled: false,
        };
        if (state.admitted >= limit) {
            state.boundaryReached = true;
            this.states.set(runId, state);
            return { decision: "block", code: LIMIT_REACHED_CODE, admitted: state.admitted, limit };
        }
        state.admitted += 1;
        this.states.set(runId, state);
        return { decision: "allow", admitted: state.admitted, limit };
    }
    checkpointPending(runId) {
        return Boolean(runId && this.states.get(runId)?.boundaryReached);
    }
    /** Returns true once per boundary run, making finalize retries bounded/idempotent. */
    requestRevision(runId) {
        if (!runId)
            return false;
        const state = this.states.get(runId);
        if (!state?.boundaryReached || state.revisionRequested)
            return false;
        state.revisionRequested = true;
        return true;
    }
    /**
     * Capture the session as soon as the tool boundary is reached. The runtime
     * may terminate a blocked tool turn before before_agent_finalize runs.
     */
    requestContinuation(runId, sessionKey) {
        if (!runId || !sessionKey)
            return false;
        const state = this.states.get(runId);
        if (!state?.boundaryReached || state.continuationRequested)
            return false;
        state.continuationRequested = true;
        state.sessionKey = sessionKey;
        return true;
    }
    /**
     * Take exactly one continuation after the terminal event. A boundary-blocked
     * tool turn can be reported as unsuccessful even after checkpoint revision,
     * so agent_end.success must not suppress recovery.
     */
    takeContinuation(runId) {
        if (!runId)
            return undefined;
        const state = this.states.get(runId);
        if (!state?.continuationRequested || state.continuationScheduled || !state.sessionKey)
            return undefined;
        state.continuationScheduled = true;
        return { runId, sessionKey: state.sessionKey };
    }
    endRun(runId) {
        return Boolean(runId && this.states.delete(runId));
    }
    snapshot(runId) {
        if (!runId)
            return undefined;
        const state = this.states.get(runId);
        if (!state)
            return undefined;
        const { sessionKey: _sessionKey, ...snapshot } = state;
        return { ...snapshot };
    }
}
