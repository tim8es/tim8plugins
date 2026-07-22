# Tool Checkpoint Guard — Development Specification

**Status:** Implemented local package v0.1; not installed or enabled  
**Target:** OpenClaw 2026.7.1 Plugin SDK  
**Plugin id:** `tool-checkpoint-guard`  
**Package:** local, unpublished  
**Purpose:** enforce a bounded tool-call investigation phase and require a user-facing checkpoint before work continues in another run.

## 1. Problem

Prompt instructions alone do not reliably stop an agent after 12 tool calls. The model can miscount, call 12 different tools, issue calls in parallel, or continue after compaction. OpenClaw's built-in loop detector primarily detects repeated patterns; it is not a general per-run budget.

The plugin must provide a hard runtime boundary:

- calls 1–12 are admitted;
- attempt 13 and every later attempt in the same agent run are blocked before tool execution;
- after the boundary is reached, the run must end with a checkpoint containing:
  1. intermediate result;
  2. blockers and unresolved uncertainty;
  3. current plan / next action.

## 2. Scope

### In scope

- A dedicated local OpenClaw policy plugin.
- Counting `before_tool_call` events per agent run.
- Blocking over-budget calls.
- Parallel tool-call batches.
- Main-agent, subagent, cron, heartbeat, and other agent runs unless a documented runtime class cannot emit the required hook context.
- Checkpoint prompting, state cleanup, narrow configuration, and deterministic unit tests.

### Out of scope

- Detecting whether two commands test the same hypothesis. That remains a reasoning policy, not a reliable generic runtime rule.
- Replacing OpenClaw's built-in repetition/loop detector.
- Persisting tool parameters or tool results.
- Resuming a blocked run. Continuation happens in a new run/turn with a fresh budget.
- Modifying OpenClaw core or `node_modules`.
- Publishing the plugin.
- Changing Gateway configuration or restarting Gateway as part of specification work.

## 3. Guarantees

### Hard guarantees

When a stable run identity is available:

1. No more than `maxToolCallsPerRun` tool-call attempts are admitted in one run.
2. Attempt `maxToolCallsPerRun + 1` is blocked before tool execution.
3. All later attempts in that run are also blocked.
4. Parallel calls share one budget; batching does not create extra capacity.
5. State from one run is never intentionally reused as the budget for another identified run.

### Checkpoint guarantee

The plugin must guarantee that an over-budget run does not silently continue. It uses two layers:

1. **Natural checkpoint:** request a final model response with the required three sections.
2. **Deterministic fallback:** if the model finalizes or sends a reply without the required structure, append or replace it with a bounded fallback checkpoint containing only safe runtime facts.

The plugin cannot deterministically reconstruct the semantic result of arbitrary work without retaining and interpreting tool outputs. Therefore:

- the natural model checkpoint may contain the substantive intermediate result;
- the deterministic fallback guarantees structure and truthful guard state, but may state that a substantive summary was not produced;
- the fallback must never invent task results.

If the installed Plugin SDK cannot safely associate an outbound `message_sending` event with the pending run, deterministic checkpoint delivery is an **implementation blocker**, not something to approximate silently.

## 4. Terminology

- **Run:** one OpenClaw agent run identified by `runId`.
- **Attempt:** one invocation of `before_tool_call`, regardless of later success, approval denial, or blocking by another plugin.
- **Admitted attempt:** an attempt not blocked by this guard.
- **Budget:** maximum admitted attempts for one run.
- **Boundary attempt:** first attempt above the budget; 13th with the default configuration.
- **Checkpoint pending:** state entered when a boundary attempt is blocked.
- **Checkpoint:** user-facing progress response ending the run and exposing result, blockers, and plan.

## 5. Policy decisions

### 5.1 Unit of accounting

Count **attempts**, not successful tool executions.

Rationale: the goal is to bound investigation churn. Failed calls, approval denials, and policy-blocked calls still consume agent effort and can form loops.

Every `before_tool_call` event consumes one slot until the budget is exhausted. `toolCallId` is recorded for diagnostics but is not used to create free retries.

### 5.2 Scope key

Primary key:

```text
run:<runId>
```

Fallback order when `runId` is absent:

1. a documented SDK run/turn identifier proven to have the same lifecycle;
2. otherwise block the call with `TOOL_CHECKPOINT_GUARD_CONTEXT_MISSING`.

Do not silently fall back to a global or long-lived `sessionKey` counter: overlapping or consecutive runs would contaminate each other.

### 5.3 Parallel calls

The admission decision must be synchronous and atomic within the JavaScript event loop:

1. read state;
2. compare count to limit;
3. increment or block;
4. return without awaiting external I/O.

For a batch of 13 calls received against count 0, exactly 12 may be admitted and at least one must be blocked. Hook logs and telemetry happen after the in-memory decision or through non-blocking host logging.

### 5.4 Checkpoint delivery boundary

The v0.1 implementation uses the documented `before_agent_finalize` revision path exactly once. It does **not** inject an outbound-message fallback: `message_sending` lacks `runId` in OpenClaw 2026.7.1, so a deterministic correlation is unavailable. The hard tool budget remains guaranteed; delivery of a checkpoint relies on the harness executing the documented revision.

### 5.5 Other plugins

Register at a documented high priority so the budget is applied early. The exact priority must be selected after inspecting installed policy hooks; it must not assume that `50` is globally unique.

Because the guard counts attempts, a later plugin blocking the same call does not refund capacity.

### 5.6 Lifecycle

A run starts lazily at its first `before_tool_call` event.

State transitions:

```text
ABSENT
  -> ACTIVE(count=1..limit)
  -> CHECKPOINT_PENDING(boundary blocked)
  -> AWAITING_DELIVERY(agent ended, checkpoint pending)
  -> CLEARED(message delivered or TTL cleanup)
```

Rules:

- `agent_end` immediately clears ordinary `ACTIVE` state.
- If a checkpoint is pending, retain only minimal delivery state until the outbound checkpoint is observed.
- `message_sent` clears retained delivery state.
- stale state is evicted after a bounded TTL.
- Gateway restart may drop in-memory state; this is acceptable because active runs are terminated by restart. The plugin does not persist counters to disk.

## 6. Hook design

The plugin owns one policy but may use several typed hooks to implement its lifecycle.

### 6.1 `before_tool_call` — hard enforcement

Responsibilities:

- resolve the run key;
- create/read run state;
- admit attempts through the configured limit;
- block every later attempt;
- mark checkpoint pending;
- return a bounded, model-visible `blockReason` with a machine-readable code and checkpoint instruction.

Conceptual result:

```ts
{
  block: true,
  blockReason:
    "TOOL_CHECKPOINT_REQUIRED: tool-call budget 12/12 reached. " +
    "Do not call more tools in this run. Finalize with intermediate result, " +
    "blockers/uncertainty, and current plan."
}
```

Do not include tool parameters, secret values, raw results, session identifiers, or stack traces.

### 6.2 `before_agent_finalize` — natural checkpoint validator

When `checkpointPending === true`:

- inspect `lastAssistantMessage`;
- accept a checkpoint only when all three machine markers are present;
- otherwise request one bounded revision using an idempotency key tied to the run;
- revision instructions explicitly prohibit further tool use;
- further tool attempts remain blocked by `before_tool_call`.

Required invisible markers:

```html
<!-- tool-checkpoint:result -->
<!-- tool-checkpoint:blockers -->
<!-- tool-checkpoint:plan -->
```

The visible headings may be localized to the conversation language. Markers avoid brittle parsing of Russian/English headings.

Revision must be bounded (`maxAttempts` set explicitly). An infinite finalization loop is forbidden.

### 6.3 Outbound fallback hook — deterministic delivery

Use the documented outbound mutation hook (`message_sending`) only after confirming its exact installed SDK context and result contract.

When the outbound message belongs to a checkpoint-pending run and lacks the markers, append a fallback such as:

```text
⏸️ Checkpoint: the 12-tool-call limit has been reached.

✅ Intermediate result
The model did not produce a verifiable summary before stopping; the plugin does not draw conclusions from raw results automatically.

⚠️ Blockers and uncertainty
The 13th call was blocked by policy. Continuation requires a new run.

🧭 Current plan
Continue from the remaining step in the next run, using this checkpoint as the boundary.
```

Requirements:

- preserve a valid natural answer unchanged;
- prefer appending fallback to replacing existing useful text;
- never expose internal identifiers or tool data;
- associate delivery with the exact pending run. If the SDK lacks an unambiguous association, fail implementation review and escalate rather than matching merely by channel.

### 6.4 `agent_end` and `message_sent` — cleanup

- clear normal run state on `agent_end`;
- retain a minimal checkpoint tombstone only if needed by outbound validation;
- clear the tombstone after confirmed delivery;
- log cleanup at debug level only.

## 7. State model

```ts
type RunState = {
  runId: string;
  admittedAttempts: number;
  blockedAttempts: number;
  checkpointPending: boolean;
  firstSeenAtMs: number;
  lastSeenAtMs: number;
  boundaryToolName?: string;
  checkpointRevisionRequested: boolean;
};
```

Storage:

- in-memory `Map<string, RunState>`;
- no disk persistence;
- no raw params or results;
- optional tool name only, with conservative length bounds;
- hard upper bound on map size plus TTL sweep to avoid leakage if lifecycle hooks are missed.

Suggested constants:

```ts
DEFAULT_LIMIT = 12
DEFAULT_STATE_TTL_MS = 30 * 60_000
MAX_TRACKED_RUNS = 1_000
```

If capacity is exhausted, the guard must fail closed for new tool calls and emit a sanitized operational error. Silent eviction of an active state could allow a run to exceed the budget.

## 8. Configuration

Keep the public interface narrow.

```json
{
  "maxToolCallsPerRun": 12
}
```

Manifest schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "maxToolCallsPerRun": {
      "type": "integer",
      "minimum": 1,
      "maximum": 100,
      "default": 12
    }
  }
}
```

Internal TTL, capacity, marker strings, error codes, and priorities are implementation constants in v1. Do not expose speculative knobs.

Invalid configuration prevents plugin activation. It must not silently revert to a default.

## 9. Package layout

```text
tool-checkpoint-guard/
├── package.json
├── openclaw.plugin.json
├── index.ts
├── src/
│   ├── guard.ts            # deep module: state machine and admission interface
│   ├── checkpoint.ts       # marker validation and fallback rendering
│   └── types.ts
├── test/
│   ├── guard.test.ts
│   ├── checkpoint.test.ts
│   └── plugin.integration.test.ts
├── SPEC.md
└── README.md
```

Core module interface should remain small:

```ts
interface ToolBudgetGuard {
  attempt(input: { runId?: string; toolName: string; nowMs: number }):
    | { decision: "allow"; admitted: number; limit: number }
    | { decision: "block"; code: string; admitted: number; limit: number };
  markRevisionRequested(runId: string): void;
  endRun(runId: string): CleanupDecision;
  confirmDelivery(runId: string): void;
  sweep(nowMs: number): SweepResult;
}
```

OpenClaw-specific hook handlers are thin adapters around this module.

## 10. Observability

Emit structured, sanitized events:

- `guard.run_started`
- `guard.boundary_blocked`
- `guard.repeat_blocked`
- `guard.checkpoint_revision_requested`
- `guard.checkpoint_fallback_applied`
- `guard.run_cleared`
- `guard.context_missing`
- `guard.capacity_exhausted`

Allowed fields:

- plugin version;
- admitted/blocked counts;
- configured limit;
- trigger/category;
- duration;
- hashed or omitted run identity according to OpenClaw logging conventions.

Forbidden fields:

- tool params and results;
- prompts and model responses;
- auth data;
- sender/chat/session identifiers in normal logs;
- `blockReason` containing sensitive context.

Normal admitted calls are not logged at info level. Boundary events are info/warn; invariants and missing context are warn/error.

## 11. Failure policy

| Failure | Required behavior |
|---|---|
| Missing stable run identity | Block tool call; sanitized `CONTEXT_MISSING` reason |
| Invalid config | Plugin does not activate |
| State capacity exhausted | Fail closed for new runs; do not evict active state silently |
| Hook throws unexpectedly | Tests must prevent this; runtime error is logged; implementation must not claim enforcement guarantee for such a run |
| Revision ignored by model | Apply deterministic outbound fallback |
| Outbound event cannot be mapped to run | Implementation blocker; do not deploy as “guaranteed checkpoint” |
| Gateway restart | Active run terminates; in-memory state loss acceptable |
| `agent_end` missing | TTL cleanup |

## 12. Security and privacy

- No network access.
- No subprocesses.
- No filesystem writes during runtime.
- No secrets in config.
- No prompt/result persistence.
- No dynamic code loading.
- No modification of OpenClaw core.
- Manifest uses `additionalProperties: false`.
- Plugin remains local and unpublished.

## 13. Tests

### 13.1 Unit — admission boundary

1. Calls 1–11 allowed.
2. Call 12 allowed.
3. Call 13 blocked.
4. Calls 14+ blocked.
5. New `runId` starts at 1.
6. Ended run is cleared.
7. Missing `runId` is blocked.
8. Invalid limits 0, negative, fractional, >100 rejected.

### 13.2 Unit — concurrency

1. Fire 13 attempts in one `Promise.all` batch against an empty run.
2. Assert exactly 12 allow decisions and one block.
3. Start at count 11 and fire 3 attempts; assert one allow and two blocks.
4. Interleave two run IDs; assert independent budgets.

### 13.3 Unit — checkpoint

1. All three markers: no revision/fallback.
2. Any missing marker: revision requested.
3. Revision is requested at most configured internal maximum.
4. Malformed final answer receives fallback.
5. Existing useful text is preserved when fallback is appended.
6. Fallback contains no run ID, params, results, or raw error.

### 13.4 Integration — Plugin SDK

Using the installed OpenClaw SDK/contracts:

1. Plugin loads from a local package and appears enabled.
2. Manifest and config schema validate.
3. 12 distinct tools are admitted; the 13th distinct tool is blocked.
4. Repeating one tool follows the same boundary.
5. Parallel tool batch cannot exceed 12 admitted attempts.
6. A denied approval still consumes an attempt.
7. Another plugin blocking later does not refund an attempt.
8. `agent_end` cleanup runs on success and error.
9. Checkpoint revision cannot call another tool.
10. Outbound fallback is associated with the correct run.
11. Main and subagent run IDs remain isolated.

### 13.5 UAT

Run in an isolated test agent/session, not the main production conversation.

Scenarios:

- **UAT-11:** request exactly 11 safe read-only calls; no checkpoint.
- **UAT-12:** request exactly 12; all execute; natural completion allowed.
- **UAT-13:** request 13 distinct safe read-only calls; first 12 execute, 13th does not; user receives checkpoint.
- **UAT-parallel:** model emits 13 calls in one batch; no more than 12 execute.
- **UAT-retry:** after boundary, instruct model to try another tool; it remains blocked.
- **UAT-malformed:** force/fixture a final answer without markers; deterministic fallback appears.
- **UAT-next-turn:** next user turn has a fresh budget.
- **UAT-subagent:** child budget does not consume parent budget.

Proof required for each scenario:

- hook event counts;
- executed tool count;
- blocked tool count and code;
- sanitized final response;
- absence of leaked params/results;
- cleanup confirmation.

## 14. Deployment plan

Deployment is a separate, explicitly authorized change:

1. Implement and test outside active OpenClaw state paths if using a coding agent.
2. Review diff and test evidence.
3. Install the local plugin using the documented OpenClaw plugin installation path.
4. Inspect existing `plugins` config; merge, never replace wholesale.
5. Run `openclaw.cmd config validate`.
6. Request/confirm Gateway restart if not already explicitly authorized.
7. Restart once using the documented restart operation.
8. Verify Gateway health and plugin load status.
9. Run isolated UAT 11/12/13.
10. Enable for normal use only after all acceptance criteria pass.

Rollback:

1. disable the single plugin entry;
2. validate config;
3. restart Gateway with authorization;
4. confirm no hook registration and healthy Gateway.

## 15. Acceptance criteria

The implementation is accepted only when:

- [ ] It uses documented typed Plugin SDK hooks; no core patching.
- [ ] Default limit is 12 and config rejects invalid values.
- [ ] Unit tests prove 11/12/13 and parallel boundaries.
- [ ] Integration test proves the 13th call is not executed.
- [ ] Subsequent calls in the same run remain blocked.
- [ ] A new run receives a fresh budget.
- [ ] Main/subagent states are isolated by run ID.
- [ ] The final user-visible checkpoint contains result, blockers, and plan, or a truthful deterministic fallback.
- [ ] The outbound checkpoint is mapped unambiguously to the pending run.
- [ ] No prompt, tool params, tool results, secrets, or raw identifiers are persisted/logged.
- [ ] State is cleaned on completion and by TTL fallback.
- [ ] `openclaw.cmd config validate` passes after installation.
- [ ] Gateway and existing channels remain healthy after the authorized restart.
- [ ] Rollback is documented and tested.

## 16. Implementation gate / unresolved contract checks

Before coding the outbound fallback adapter, confirm against the installed Plugin SDK:

1. exact `message_sending` event/result fields;
2. whether it exposes `runId`, `turnId`, or another unambiguous correlation key;
3. ordering of `before_agent_finalize`, `agent_end`, `message_sending`, and `message_sent`;
4. behavior when `before_agent_finalize` exceeds `retry.maxAttempts`;
5. whether all target run classes provide `runId` to `before_tool_call`.

Failure of checks 2 or 3 requires revising the architecture before implementation. The hard tool budget remains feasible; the claim of deterministic checkpoint delivery does not.
