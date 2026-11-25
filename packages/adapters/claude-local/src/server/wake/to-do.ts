import { asString, parseObject } from "@paperclipai/adapter-utils/server-utils";
import { lines, type Ctx, type WakeBlock, type WakePartMeta } from "./context.js";
import { COMMON_RULES, HEADINGS, INTERACTION_LANGUAGE } from "./templates.js";
import type { WhatHappened } from "./what-happened.js";

/**
 * "What to do now": the events' rules, then the rules every wake keeps, and the texts that
 * follow them (the interaction language, connection instructions, MCP app context).
 */

export const TO_DO_PART_META: WakePartMeta = {
  "wake.to_do": { label: "What to do now", source: "claude_local wake: each event's rules" },
  "wake.common_rules": { label: "Rules every wake keeps", source: "claude_local wake: common rules" },
  "wake.interaction_language": { label: "Interaction language", source: "wake payload: simplifiedEnglishInteractions (experimental setting)" },
  "wake.connection_instructions": { label: "Connection instructions", source: "wake payload: connectionInstructions" },
  "wake.mcp_app_context": { label: "MCP app context", source: "wake payload: mcpAppContext" },
};

export function renderToDo(ctx: Ctx, events: Pick<WhatHappened, "rules" | "ruleBlocks">): WakeBlock[] {
  const blocks: WakeBlock[] = [];
  const bullets = events.rules.map((rule) => `- ${rule}`).join("\n");
  blocks.push({ id: "wake.to_do", text: lines(HEADINGS.toDo, bullets, ...events.ruleBlocks) });
  blocks.push({
    id: "wake.common_rules",
    text: COMMON_RULES.map((rule) => `- ${rule}`).join("\n"),
    // One list with the event rules, unless a block of rules sits between them.
    separator: bullets && events.ruleBlocks.length === 0 ? "\n" : "\n\n",
  });
  if (ctx.wake.simplifiedEnglishInteractions) blocks.push({ id: "wake.interaction_language", text: INTERACTION_LANGUAGE });
  const raw = parseObject(ctx.raw);
  const connectionInstructions = asString(parseObject(raw.connectionInstructions).text, "").trim();
  if (connectionInstructions) blocks.push({ id: "wake.connection_instructions", text: connectionInstructions });
  const mcpAppContext = asString(raw.mcpAppContext, "").trim();
  if (mcpAppContext) blocks.push({ id: "wake.mcp_app_context", text: mcpAppContext });
  return blocks;
}
