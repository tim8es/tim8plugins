# OpenClaw Plugins

Policy plugins for [OpenClaw](https://github.com/) agent gateways. Each plugin is a standalone, dependency-light package under its own directory.

## Plugins

### [claw-approval-policy-plugin](claw-approval-policy-plugin/)

Minimal, dependency-free policy plugin. Requires human approval for selected tools (e.g. `web_search`, `web_fetch`, `browser`) and for `exec` calls whose working directory or referenced paths fall outside configured workspace roots. Renders a structured approval card (action, target, agent's reasoning, reason, risk) since the host may not display raw tool parameters.

### [claw-checkpoint-guard](claw-checkpoint-guard/)

TypeScript policy plugin that enforces a bounded number of tool-call attempts per agent run. Once the budget is exhausted, further tool calls are blocked and the agent must produce a user-visible checkpoint (result, blockers, revised plan) before the run ends.

## License

[MIT](LICENSE)
