# Approval Policy

Minimal, dependency-free OpenClaw policy plugin. No sandbox and no build step.

## Rules

- Tools in `approvalTools` always require approval (default: `web_search`, `web_fetch`, `browser`).
- Tools in `execTools` are allowed without this plugin prompt only when `workdir` and all explicit paths are under `workspaceRoots`.
- Unknown or dynamic exec scope requires approval when `failClosed` is `true`.
- Approval offers only `allow-once` and `deny`.

## Approval card

Because OpenClaw does not render the full command/params inside the Telegram
approval prompt, every approval request from this plugin is a structured card:

```
🔧 Action: <what the tool does>

🎯 Target:
<command / URL / browser action / affected paths>

🗣️ Agent's reasoning: <intent, if the agent supplied one>

📌 Request reason: <why the policy triggered>

⚠️ Risk: <what's dangerous about the action>
```

The target line is extracted from the tool params (`command`+`workdir` for exec;
`action`/`url`/`query`/`selector`/`text`/`path` for browser and web tools), so the
approver sees the concrete operation, its purpose, and its risk before deciding.

### Agent-supplied reasoning

The `🗣️ Agent's reasoning` line is optional and appears only when the agent puts a
free-text justification into the tool params. The plugin reads the field named by
`intentParam` (default `reasoning` — the tool-call standard), falling back to the
aliases `intent`, `purpose`, `explanation`. If none are present, the line is
omitted and only the static policy reason is shown.

> Note: standard tools like `exec`/`browser` may not declare such a param in their
> schema, in which case the host can strip the extra argument before the call. The
> line then simply does not appear — the rest of the card is unaffected.

## Test

```powershell
node --test policy.test.js
```

## Configuration

```json5
{
  plugins: {
    load: {
      paths: [
        "C:\\path\\to\\workspace\\approval-policy-plugin"
      ]
    },
    entries: {
      "approval-policy": {
        enabled: true,
        config: {
          workspaceRoots: ["C:\\path\\to\\workspace"],
          defaultWorkdir: "C:\\path\\to\\workspace",
          approvalTools: ["web_search", "web_fetch", "browser"],
          execTools: ["exec"],
          failClosed: true,
          intentParam: "reasoning"
        }
      }
    }
  }
}
```

Plugin approval routing is configured independently under `approvals.plugin`.

## Security boundary

This is an application guardrail, not OS isolation. A workspace-local script may access external files at runtime. Hard isolation requires Windows ACLs, a restricted account, or a VM.
