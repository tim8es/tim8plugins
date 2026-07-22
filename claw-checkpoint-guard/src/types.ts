export const CONTEXT_MISSING_CODE = "TOOL_CHECKPOINT_GUARD_CONTEXT_MISSING";
export const LIMIT_REACHED_CODE = "TOOL_CHECKPOINT_GUARD_LIMIT_REACHED";

export type GuardDecision =
  | { decision: "allow"; admitted: number; limit: number }
  | {
      decision: "block";
      code: typeof CONTEXT_MISSING_CODE | typeof LIMIT_REACHED_CODE;
      admitted: number;
      limit: number;
    };

export interface GuardConfig {
  maxToolCallsPerRun: number;
}

export interface RunSnapshot {
  admitted: number;
  boundaryReached: boolean;
  revisionRequested: boolean;
  continuationRequested: boolean;
  continuationScheduled: boolean;
}

export interface ContinuationRequest {
  runId: string;
  sessionKey: string;
}
