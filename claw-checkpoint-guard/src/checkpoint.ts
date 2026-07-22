export const CHECKPOINT_INSTRUCTION = [
  "HARD STOP: tool-call checkpoint required.",
  "Do not call any more tools in this run; every further tool call will be blocked.",
  "Your next action must be a user-visible checkpoint reply, not another tool call.",
  "Reply to user with exactly these labelled sections:",
  "1. Intermediate result — verified findings so far.",
  "2. Blockers and uncertainty — what remains unverified, failed, or was discarded.",
  "3. Current plan — revised next action, its hypothesis, and why it is not a repeat of a failed path.",
  "Briefly reflect on evidence and change the approach when the previous route failed.",
  "End after the checkpoint; a new run will continue automatically with a fresh tool budget.",
  "Do not ask the user to confirm, reply, or send a continue message.",
  "Do not claim work not completed.",
].join(" ");

export function formatLimitBlock(admitted: number, limit: number): string {
  return `TOOL_CHECKPOINT_GUARD_LIMIT_REACHED: ${admitted}/${limit} tool-call attempts already admitted in this run. ${CHECKPOINT_INSTRUCTION}`;
}

export const CHECKPOINT_IDEMPOTENCY_KEY = "tool-checkpoint-guard:checkpoint:v1";
export const CONTINUATION_INSTRUCTION = [
  "Automatically continue the user's original task after the prior tool-call checkpoint; no user reply is required.",
  "The prior turn already gave the user an intermediate result; do not repeat it unless needed.",
  "Use the current plan and available conversation evidence, then continue working.",
  "This is a new agent run with a fresh tool-call budget.",
].join(" ");
