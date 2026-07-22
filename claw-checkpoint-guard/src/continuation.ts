const TAG_PREFIX = "tool-checkpoint-guard-continue-";
const MAX_TAG_SUFFIX_LENGTH = 48;

/**
 * Cron-backed session turns reject reserved name delimiters such as `:`.
 * Keep the cleanup tag conservative because run ids are host-provided.
 */
export function continuationTag(runId: string): string {
  const safeRunId = runId.replace(/[^A-Za-z0-9_-]/g, "-").slice(-MAX_TAG_SUFFIX_LENGTH) || "run";
  return `${TAG_PREFIX}${safeRunId}`;
}

/** Bounds consecutive automatic resumptions for one session. */
export class ContinuationLimiter {
  private readonly counts = new Map<string, number>();

  public constructor(private readonly maximum: number) {
    if (!Number.isInteger(maximum) || maximum < 1 || maximum > 20) {
      throw new Error("maxAutoContinuations must be an integer from 1 through 20");
    }
  }

  public reserve(sessionKey: string): number | undefined {
    const next = (this.counts.get(sessionKey) ?? 0) + 1;
    if (next > this.maximum) return undefined;
    this.counts.set(sessionKey, next);
    return next;
  }

  public reset(sessionKey?: string): void {
    if (sessionKey) this.counts.delete(sessionKey);
  }
}
