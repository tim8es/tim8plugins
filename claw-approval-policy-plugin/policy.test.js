import test from "node:test";
import assert from "node:assert/strict";
import { decidePolicy, isInsideRoots, resolveConfig } from "./policy.js";

const ROOT = "C:\\path\\to\\workspace";
const decide = (toolName, params = {}, config = { workspaceRoots: [ROOT] }) =>
  decidePolicy({ toolName, params }, config);

test("configured web and browser tools require approval", () => {
  assert.equal(decide("web_search").action, "approve");
  assert.equal(decide("web_fetch").action, "approve");
  assert.equal(decide("browser").action, "approve");
});

test("browser approval card names the action and target", () => {
  const decision = decide("browser", { action: "navigate", url: "https://example.com" });
  assert.equal(decision.action, "approve");
  const { description } = decision.approval;
  assert.match(description, /Action:/);
  assert.match(description, /navigate/);
  assert.match(description, /https:\/\/example\.com/);
  assert.match(description, /Risk:/);
});

test("agent-supplied reasoning appears in the approval card", () => {
  const decision = decide("browser", {
    action: "navigate",
    url: "https://example.com",
    reasoning: "Opening the dashboard to capture current metrics.",
  });
  assert.match(decision.approval.description, /Agent's reasoning: Opening the dashboard/);
});

test("intent param name is configurable and aliases still work", () => {
  const custom = decidePolicy(
    { toolName: "browser", params: { why: "custom field" } },
    { workspaceRoots: [ROOT], intentParam: "why" },
  );
  assert.match(custom.approval.description, /Agent's reasoning: custom field/);

  const alias = decide("exec", { command: "git status", workdir: "C:\\Windows", intent: "checking the repo" });
  assert.match(alias.approval.description, /Agent's reasoning: checking the repo/);
});

test("exec approval card includes the command and workdir", () => {
  const decision = decide("exec", { command: "git status", workdir: "C:\\Windows" });
  assert.equal(decision.reason, "external-workdir");
  assert.match(decision.approval.description, /git status/);
  assert.match(decision.approval.description, /C:\\Windows/);
});

test("unmanaged tools are allowed", () => {
  assert.equal(decide("read").action, "allow");
});

test("workspace-local exec is allowed with explicit or default workdir", () => {
  assert.equal(decide("exec", { command: "node .\\scripts\\check.js", workdir: `${ROOT}\\project` }).action, "allow");
  assert.equal(decide("exec", { command: "git status" }).action, "allow");
});

test("external workdir requires approval", () => {
  assert.equal(decide("exec", { command: "git status", workdir: "C:\\Windows" }).reason, "external-workdir");
});

test("external and ambiguous paths require approval", () => {
  const commands = [
    "python C:\\Users\\someone\\outside.py",
    "node ..\\..\\outside.js",
    "type \\\\server\\share\\file.txt",
    "node ~\\script.js",
  ];
  for (const command of commands) {
    assert.equal(decide("exec", { command, workdir: `${ROOT}\\project` }).action, "approve");
  }
});

test("dynamic path syntax fails closed", () => {
  const commands = [
    "python $env:TEMP\\x.py",
    "node %TEMP%\\x.js",
    "node ${HOME}\\x.js",
    "node $(Get-Location)\\x.js",
    "Get-Content .\\*.txt",
    "node `whoami`.js",
  ];
  for (const command of commands) {
    assert.equal(decide("exec", { command, workdir: ROOT }).reason, "dynamic-command");
  }
});

test("missing command fails closed", () => {
  assert.equal(decide("exec", { workdir: ROOT }).reason, "missing-command");
});

test("same-prefix sibling is outside", () => {
  assert.equal(isInsideRoots(`${ROOT}\\project`, [ROOT]), true);
  assert.equal(isInsideRoots(`${ROOT}-evil\\project`, [ROOT]), false);
});

test("rules are configurable", () => {
  const config = resolveConfig({
    workspaceRoots: ["D:\\safe"],
    approvalTools: ["browser"],
    execTools: ["shell"],
    failClosed: false,
  });
  assert.equal(decidePolicy({ toolName: "browser", params: {} }, config).action, "approve");
  assert.equal(decidePolicy({ toolName: "web_search", params: {} }, config).action, "allow");
  assert.equal(decidePolicy({ toolName: "shell", params: { command: "git status", workdir: "D:\\safe" } }, config).action, "allow");
});
