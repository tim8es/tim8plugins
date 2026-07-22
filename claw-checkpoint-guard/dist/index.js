import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { CHECKPOINT_IDEMPOTENCY_KEY, CHECKPOINT_INSTRUCTION, CONTINUATION_INSTRUCTION, formatLimitBlock, } from "./src/checkpoint.js";
import { ContinuationLimiter, continuationTag } from "./src/continuation.js";
import { ToolBudgetGuard } from "./src/guard.js";
import { CONTEXT_MISSING_CODE, LIMIT_REACHED_CODE } from "./src/types.js";
const DEFAULT_MAX_TOOL_CALLS = 15;
const DEFAULT_MAX_AUTO_CONTINUATIONS = 8;
const HOOK_PRIORITY = 1000;
const CONTINUATION_DELAY_MS = 250;
function readLimit(value) {
    if (value === undefined)
        return DEFAULT_MAX_TOOL_CALLS;
    if (!Number.isInteger(value) || typeof value !== "number" || value < 1 || value > 100) {
        throw new Error("tool-checkpoint-guard: maxToolCallsPerRun must be an integer from 1 through 100");
    }
    return value;
}
function readContinuationLimit(value) {
    if (value === undefined)
        return DEFAULT_MAX_AUTO_CONTINUATIONS;
    if (!Number.isInteger(value) || typeof value !== "number" || value < 1 || value > 20) {
        throw new Error("tool-checkpoint-guard: maxAutoContinuations must be an integer from 1 through 20");
    }
    return value;
}
function blockMessage(code, admitted, limit) {
    if (code === CONTEXT_MISSING_CODE) {
        return `${CONTEXT_MISSING_CODE}: missing stable run identity; tool execution denied.`;
    }
    return formatLimitBlock(admitted, limit);
}
export default definePluginEntry({
    id: "tool-checkpoint-guard",
    name: "Tool Checkpoint Guard",
    description: "Enforces a bounded per-run tool-call phase, checkpoint, and continuation turn.",
    register(api) {
        const rawConfig = api.pluginConfig;
        const configuredLimit = readLimit(rawConfig && typeof rawConfig === "object"
            ? rawConfig.maxToolCallsPerRun
            : undefined);
        const configuredContinuationLimit = readContinuationLimit(rawConfig && typeof rawConfig === "object"
            ? rawConfig.maxAutoContinuations
            : undefined);
        const guard = new ToolBudgetGuard({ maxToolCallsPerRun: configuredLimit });
        const continuationLimiter = new ContinuationLimiter(configuredContinuationLimit);
        api.on("before_tool_call", (event, ctx) => {
            const decision = guard.attempt(event.runId);
            if (decision.decision === "allow")
                return;
            if (decision.code === LIMIT_REACHED_CODE) {
                guard.requestContinuation(event.runId, ctx.sessionKey);
            }
            return { block: true, blockReason: blockMessage(decision.code, decision.admitted, decision.limit) };
        }, { priority: HOOK_PRIORITY });
        api.on("before_agent_finalize", (event, ctx) => {
            const runId = event.runId ?? ctx.runId;
            if (!guard.requestRevision(runId))
                return;
            // Fallback for runtimes that omit sessionKey from before_tool_call context.
            guard.requestContinuation(runId, event.sessionKey ?? ctx.sessionKey);
            return {
                action: "revise",
                reason: "Tool-call budget reached; publish checkpoint before continuation.",
                retry: {
                    instruction: CHECKPOINT_INSTRUCTION,
                    idempotencyKey: CHECKPOINT_IDEMPOTENCY_KEY,
                    maxAttempts: 1,
                },
            };
        }, { priority: HOOK_PRIORITY });
        api.on("agent_end", async (event, ctx) => {
            const runId = event.runId ?? ctx.runId;
            const continuation = guard.takeContinuation(runId);
            try {
                if (!continuation) {
                    continuationLimiter.reset(ctx.sessionKey);
                    return;
                }
                const sequence = continuationLimiter.reserve(continuation.sessionKey);
                if (sequence === undefined) {
                    continuationLimiter.reset(continuation.sessionKey);
                    api.logger.warn(`tool-checkpoint-guard: automatic continuation limit (${configuredContinuationLimit}) reached for session`);
                    return;
                }
                const scheduled = await api.session.workflow.scheduleSessionTurn({
                    sessionKey: continuation.sessionKey,
                    message: CONTINUATION_INSTRUCTION,
                    delayMs: CONTINUATION_DELAY_MS,
                    deleteAfterRun: true,
                    deliveryMode: "announce",
                    name: `Tool checkpoint continuation ${sequence}`,
                    tag: continuationTag(continuation.runId),
                });
                if (!scheduled) {
                    throw new Error("host did not create a continuation scheduler job");
                }
            }
            finally {
                guard.endRun(runId);
            }
        }, { priority: HOOK_PRIORITY });
    },
});
