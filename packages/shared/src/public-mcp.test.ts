import { describe, expect, it } from "vitest";
import { approveApprovalSchema } from "./permission-request.js";
import { mcpConsentSchema, updateMcpConnectionSchema } from "./public-mcp.js";

const agentId = "6f0c5b0e-6a8f-4f39-9d3a-3f9f1f0d2c11";
const companyId = "c3948f92-4af2-414f-81c4-88f1c59bf2ab";

describe("mcpConsentSchema", () => {
  it("takes acts-as and a level", () => {
    expect(mcpConsentSchema.parse({ decision: "approve", companyId, actAsAgentId: agentId, accessLevel: "worker" }))
      .toEqual({ decision: "approve", companyId, actAsAgentId: agentId, accessLevel: "worker" });
  });

  it("leaves both out for a plain approval as the person", () => {
    expect(mcpConsentSchema.parse({ decision: "approve", companyId })).toEqual({ decision: "approve", companyId });
    expect(mcpConsentSchema.parse({ decision: "deny" })).toEqual({ decision: "deny" });
  });

  it("refuses the old checkboxes and unknown levels", () => {
    expect(mcpConsentSchema.safeParse({ decision: "approve", companyId, allowWrites: true }).success).toBe(false);
    expect(mcpConsentSchema.safeParse({ decision: "approve", companyId, accessLevel: "owner" }).success).toBe(false);
  });
});

describe("updateMcpConnectionSchema", () => {
  it("takes any of acts-as, level and overrides", () => {
    expect(updateMcpConnectionSchema.parse({ actAsAgentId: null })).toEqual({ actAsAgentId: null });
    expect(updateMcpConnectionSchema.parse({ accessLevel: "admin", accessOverrides: { "tasks:delete": true } }))
      .toEqual({ accessLevel: "admin", accessOverrides: { "tasks:delete": true } });
  });

  it("refuses an empty change and unknown actions", () => {
    expect(updateMcpConnectionSchema.safeParse({}).success).toBe(false);
    expect(updateMcpConnectionSchema.safeParse({ accessOverrides: { "tasks:destroy": true } }).success).toBe(false);
  });
});

describe("approveApprovalSchema", () => {
  it("keeps the decision note and adds alwaysAllow", () => {
    expect(approveApprovalSchema.parse({ decisionNote: "ok", alwaysAllow: true })).toEqual({ decisionNote: "ok", alwaysAllow: true });
    expect(approveApprovalSchema.parse({})).toEqual({});
  });
});
