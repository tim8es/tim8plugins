# Tool Checkpoint Guard

Local, unpublished OpenClaw policy plugin. It reserves a bounded number of tool-call attempts for each `runId`, blocks every later attempt before execution, and asks the agent for one user-facing checkpoint before finalization.

## Guarantees implemented

- Default: 15 permitted `before_tool_call` attempts per run; call 16 is blocked.
- The first blocked result contains an explicit hard stop: no more tools in the run; the next action must be a user-visible checkpoint.
- The checkpoint requires verified findings, blockers/discarded paths, and a revised plan/hypothesis so the agent reflects instead of blindly retrying.
- State key: `runId` only. A missing `runId` is denied (`TOOL_CHECKPOINT_GUARD_CONTEXT_MISSING`), preventing cross-run/session contamination.
- Attempts are counted even when later policy hooks deny the call.
- Synchronous in-memory admission means a parallel batch cannot exceed the limit.
- A boundary crossing permits exactly one `before_agent_finalize` revision.
- At the boundary, the session is captured once. On `agent_end`, a Cron-backed session turn automatically resumes the original task with a fresh budget; no user reply is required.
- Automatic chains are bounded by `maxAutoContinuations` (default 8) and reset after a run completes without another boundary.
- Scheduler cleanup tags are sanitized because Cron rejects reserved delimiters such as `:`.
- `agent_end` clears state for the run.

## Deliberate non-guarantee

No outbound-message fallback is implemented. In OpenClaw 2026.7.1, `message_sending` has no `runId`, therefore it cannot be safely correlated with a run. The checkpoint contract relies on the documented `before_agent_finalize` revise path. If a model/provider cannot produce a revision, OpenClaw may end without a deterministic delivered checkpoint; the hard tool boundary still holds.

## Files

- `index.ts` — thin documented typed-hook adapter.
- `src/guard.ts` — run-scoped state machine.
- `src/checkpoint.ts` — bounded checkpoint instruction.
- `test/` — 11/12/13, missing context, parallel batch, isolation/cleanup, and idempotent revision tests.

## Verification

```powershell
npm run check
```

Expected: TypeScript compilation and all `node:test` tests passing.

## Activation

After updating an installed package, restart the Gateway to load the new plugin code. Package installation alone does not restart the Gateway.
