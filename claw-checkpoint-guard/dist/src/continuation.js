const TAG_PREFIX = "tool-checkpoint-guard-continue-";
const MAX_TAG_SUFFIX_LENGTH = 48;
/**
 * Cron-backed session turns reject reserved name delimiters such as `:`.
 * Keep the cleanup tag conservative because run ids are host-provided.
 */
export function continuationTag(runId) {
    const safeRunId = runId.replace(/[^A-Za-z0-9_-]/g, "-").slice(-MAX_TAG_SUFFIX_LENGTH) || "run";
    return `${TAG_PREFIX}${safeRunId}`;
}
/** Bounds consecutive automatic resumptions for one session. */
export class ContinuationLimiter {
    maximum;
    counts = new Map();
    constructor(maximum) {
        this.maximum = maximum;
        if (!Number.isInteger(maximum) || maximum < 1 || maximum > 20) {
            throw new Error("maxAutoContinuations must be an integer from 1 through 20");
        }
    }
    reserve(sessionKey) {
        const next = (this.counts.get(sessionKey) ?? 0) + 1;
        if (next > this.maximum)
            return undefined;
        this.counts.set(sessionKey, next);
        return next;
    }
    reset(sessionKey) {
        if (sessionKey)
            this.counts.delete(sessionKey);
    }
}
