import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { decidePolicy } from "./policy.js";

export default definePluginEntry({
  id: "approval-policy",
  name: "Approval Policy",
  description: "Require approval for selected tools and exec outside configured workspace roots.",
  register(api) {
    api.on("before_tool_call", async (event) => {
      const decision = decidePolicy(event, event.context?.pluginConfig);
      return decision.action === "approve"
        ? { requireApproval: decision.approval }
        : undefined;
    });
  },
});
