import path from "node:path";

export const DEFAULT_CONFIG = Object.freeze({
  workspaceRoots: ["C:\\path\\to\\workspace"],
  defaultWorkdir: "C:\\path\\to\\workspace",
  approvalTools: ["web_search", "web_fetch", "browser"],
  execTools: ["exec"],
  failClosed: true,
  intentParam: "reasoning",
});

// Fallback param names that carry an agent-authored intent, checked when the
// configured `intentParam` is absent. `reasoning` is the tool-call standard.
const INTENT_PARAM_ALIASES = Object.freeze(["reasoning", "intent", "purpose", "explanation"]);

const TIMEOUT_MS = 10 * 60 * 1000;
const MAX_FIELD = 500;

// Human-readable "what does this tool do" phrasing for the Telegram approval
// audience. Falls back to the raw tool name when unknown.
const TOOL_ACTIONS = Object.freeze({
  web_search: "Web search — sends a query to an external search engine",
  web_fetch: "Page fetch — downloads content from an external URL",
  browser: "Browser control — navigation, clicks, and input on a web page",
  exec: "Run a terminal command",
});

// Risk phrasing per approval reason. Keeps the Telegram approver informed even
// though OpenClaw does not render the full command/params inline.
const RISK_BY_REASON = Object.freeze({
  "configured-tool": "The action touches external resources and may expose data or change state outside the working directory.",
  "missing-command": "No command was supplied, so its scope cannot be verified.",
  "external-workdir": "The working directory is outside the allowed workspace roots — it may reach unrelated files.",
  "dynamic-command": "The command contains dynamic path segments (variables/substitutions) whose real target cannot be verified in advance.",
  "home-relative-path": "The path points into the user's home directory, outside the workspace roots.",
  "external-command-path": "The command references a path outside the allowed workspace roots.",
});

function stringList(value, fallback) {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim())
    ? value.map((item) => item.trim())
    : fallback;
}

export function resolveConfig(input = {}) {
  const workspaceRoots = stringList(input.workspaceRoots, DEFAULT_CONFIG.workspaceRoots);
  return {
    workspaceRoots,
    defaultWorkdir:
      typeof input.defaultWorkdir === "string" && input.defaultWorkdir.trim()
        ? input.defaultWorkdir.trim()
        : workspaceRoots[0],
    approvalTools: stringList(input.approvalTools, DEFAULT_CONFIG.approvalTools),
    execTools: stringList(input.execTools, DEFAULT_CONFIG.execTools),
    failClosed: typeof input.failClosed === "boolean" ? input.failClosed : DEFAULT_CONFIG.failClosed,
    intentParam:
      typeof input.intentParam === "string" && input.intentParam.trim()
        ? input.intentParam.trim()
        : DEFAULT_CONFIG.intentParam,
  };
}

function normalize(candidate) {
  return path.win32.resolve(candidate).replace(/[\\/]+$/, "").toLowerCase();
}

export function isInsideRoots(candidate, roots) {
  const target = normalize(candidate);
  return roots.some((root) => {
    const base = normalize(root);
    return target === base || target.startsWith(`${base}\\`);
  });
}

function truncate(value) {
  const text = String(value).replace(/\s+/g, " ").trim();
  return text.length > MAX_FIELD ? `${text.slice(0, MAX_FIELD)}…` : text;
}

// Extract the meaningful "what is the agent acting on" fields from tool params
// so the approver sees the target even when OpenClaw hides the raw payload.
function describeTarget(toolName, params) {
  if (!params || typeof params !== "object") return "";
  const lines = [];
  const add = (label, key) => {
    const raw = params[key];
    if (typeof raw === "string" ? raw.trim() : raw != null && raw !== "") {
      lines.push(`${label}: ${truncate(raw)}`);
    }
  };
  if (toolName === "exec") {
    add("Command", "command");
    add("Directory", "workdir");
    add("Directory", "cwd");
  } else {
    add("Action", "action");
    add("URL", "url");
    add("Query", "query");
    add("Selector", "selector");
    add("Text", "text");
    add("Path", "path");
  }
  // Fallback: dump remaining primitive fields so nothing meaningful is hidden.
  // Skip intent fields — they are surfaced separately as the agent explanation.
  if (!lines.length) {
    for (const [key, raw] of Object.entries(params)) {
      if (INTENT_PARAM_ALIASES.includes(key)) continue;
      if (raw != null && typeof raw !== "object") lines.push(`${key}: ${truncate(raw)}`);
    }
  }
  return lines.join("\n");
}

// Pull an agent-authored intent from the tool params: the configured field
// first, then the standard aliases. Returns "" when the agent supplied none.
function extractAgentIntent(params, intentParam) {
  if (!params || typeof params !== "object") return "";
  for (const key of [intentParam, ...INTENT_PARAM_ALIASES]) {
    const raw = params[key];
    if (typeof raw === "string" && raw.trim()) return truncate(raw);
  }
  return "";
}

// Build a structured, readable approval card: action → target → purpose → risk.
// `purpose` is the static, policy-derived reason; an agent-supplied intent (if
// present) is shown as its own "Agent's reasoning" line so both are visible.
function approval(toolName, reason, params, { purpose, severity = "warning", target, intentParam } = {}) {
  const action = TOOL_ACTIONS[toolName] ?? `Call tool "${toolName}"`;
  const resolvedTarget = target ?? describeTarget(toolName, params);
  const risk = RISK_BY_REASON[reason] ?? "The action requires operator confirmation.";
  const agentIntent = extractAgentIntent(params, intentParam);

  const sections = [`🔧 Action: ${action}`];
  if (resolvedTarget) sections.push(`🎯 Target:\n${resolvedTarget}`);
  if (agentIntent) sections.push(`🗣️ Agent's reasoning: ${agentIntent}`);
  if (purpose) sections.push(`📌 Request reason: ${purpose}`);
  sections.push(`⚠️ Risk: ${risk}`);
  const description = sections.join("\n\n");

  return {
    action: "approve",
    reason,
    approval: {
      title: `Confirm: ${action}`,
      description,
      severity,
      timeoutMs: TIMEOUT_MS,
      timeoutBehavior: "deny",
      timeoutReason: "Approval timed out; operation denied.",
      allowedDecisions: ["allow-once", "deny"],
    },
  };
}

function tokenize(command) {
  const tokens = [];
  const pattern = /"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s;&|<>()[\]{}`]+)/g;
  for (const match of command.matchAll(pattern)) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  return tokens;
}

function resolvePathToken(token, workdir) {
  if (/^[a-z]:[\\/]/i.test(token) || token.startsWith("\\\\") || token.startsWith("//")) {
    return path.win32.resolve(token);
  }
  if (/^~[\\/]/.test(token)) return null;
  if (/^\.{1,2}[\\/]/.test(token)) return path.win32.resolve(workdir, token);
  return undefined;
}

function hasDynamicPath(command) {
  return /(?:\$env:|%[^%\r\n]+%|\$\{|\$\(|`|[*?])/i.test(command);
}

export function decidePolicy(event, rawConfig = {}) {
  const config = resolveConfig(rawConfig);
  const toolName = event?.toolName;
  const params = event?.params ?? {};

  if (config.approvalTools.includes(toolName)) {
    return approval(toolName, "configured-tool", params, {
      intentParam: config.intentParam,
      purpose: `Tool "${toolName}" is configured to always require confirmation.`,
    });
  }
  if (!config.execTools.includes(toolName)) {
    return { action: "allow", reason: "unmanaged-tool" };
  }

  const command = typeof params.command === "string" ? params.command.trim() : "";
  const workdirValue = typeof params.workdir === "string" ? params.workdir : params.cwd;
  const workdir =
    typeof workdirValue === "string" && workdirValue.trim()
      ? workdirValue.trim()
      : config.defaultWorkdir;

  if (!command) {
    return config.failClosed
      ? approval(toolName, "missing-command", params, {
          intentParam: config.intentParam,
          severity: "critical",
          purpose: "No command was supplied to run.",
        })
      : { action: "allow", reason: "missing-command-fail-open" };
  }
  if (!isInsideRoots(workdir, config.workspaceRoots)) {
    return approval(toolName, "external-workdir", params, {
      intentParam: config.intentParam,
      severity: "critical",
      purpose: `Working directory is outside the allowed roots: ${workdir}`,
    });
  }
  if (hasDynamicPath(command)) {
    return config.failClosed
      ? approval(toolName, "dynamic-command", params, {
          intentParam: config.intentParam,
          severity: "critical",
          purpose: "The command contains dynamic paths that cannot be checked statically.",
        })
      : { action: "allow", reason: "dynamic-command-fail-open" };
  }

  for (const token of tokenize(command)) {
    const resolved = resolvePathToken(token, workdir);
    if (resolved === null) {
      return approval(toolName, "home-relative-path", params, {
        intentParam: config.intentParam,
        severity: "critical",
        purpose: `The command references the home directory: ${token}`,
      });
    }
    if (resolved && !isInsideRoots(resolved, config.workspaceRoots)) {
      return approval(toolName, "external-command-path", params, {
        intentParam: config.intentParam,
        severity: "critical",
        purpose: `The command references a path outside the allowed roots: ${token}`,
      });
    }
  }
  return { action: "allow", reason: "workspace-local-exec" };
}
