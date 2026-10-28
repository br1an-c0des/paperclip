import type { CompanySecret, SecretProposalView } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { coverageLabel, keyFromName, keyProblem, listedProviders, organizationSecrets, proposalMeta, proposalTitle, secretCounts, storedIn, usesLabel } from "./secrets-model";

function secret(overrides: Partial<CompanySecret>): CompanySecret {
  return {
    id: "s",
    companyId: "c",
    scope: "company",
    ownerUserId: null,
    userSecretDefinitionId: null,
    key: "K",
    name: "K",
    provider: "local_encrypted",
    status: "active",
    managedMode: "paperclip_managed",
    externalRef: null,
    providerConfigId: null,
    providerMetadata: null,
    latestVersion: 1,
    description: null,
    lastResolvedAt: null,
    lastRotatedAt: null,
    deletedAt: null,
    createdByAgentId: null,
    createdByUserId: null,
    createdAt: new Date("2026-09-12"),
    updatedAt: new Date("2026-09-12"),
    ...overrides,
  };
}

describe("organization secrets", () => {
  it("leaves out deleted and personal secrets, by name", () => {
    const list = organizationSecrets([
      secret({ id: "b", name: "BYBIT" }),
      secret({ id: "a", name: "ANTHROPIC" }),
      secret({ id: "d", name: "GONE", status: "deleted" }),
      secret({ id: "u", name: "MINE", scope: "user" }),
    ]);
    expect(list.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("says where a value is stored", () => {
    expect(storedIn(secret({}), [])).toBe("Paperclip vault");
    expect(storedIn(secret({ provider: "aws_secrets_manager", providerConfigId: "p" }), [{ id: "p", displayName: "AWS prod" } as never])).toBe("AWS prod");
  });

  it("counts uses", () => {
    expect(usesLabel(0)).toBe("Not used");
    expect(usesLabel(1)).toBe("1 use");
    expect(usesLabel(6)).toBe("6 uses");
  });

  it("lists configured providers and any holding secrets", () => {
    const counts = secretCounts([secret({ provider: "vault" })]);
    const listed = listedProviders(
      [
        { id: "local_encrypted", label: "", requiresExternalRef: false, configured: true },
        { id: "aws_secrets_manager", label: "", requiresExternalRef: false, configured: false },
        { id: "vault", label: "", requiresExternalRef: true, configured: false },
      ],
      counts,
    );
    expect(listed.map((entry) => entry.id)).toEqual(["local_encrypted", "vault"]);
  });
});

describe("proposals", () => {
  const base = {
    kind: "secret",
    proposedName: "COINGLASS_API_KEY",
    proposedKey: null,
    proposedBy: { id: "a", name: "Quant Researcher", icon: null },
    justification: "For liquidation heatmaps",
    originIssue: { id: "i", key: "TRA-41", title: "t" },
    createdAt: "2026-10-27T10:40:00",
  } as unknown as SecretProposalView;

  it("names who asked and for what", () => {
    expect(proposalTitle(base)).toEqual({ who: "Quant Researcher", what: "asked for a new secret,", name: "COINGLASS_API_KEY" });
    expect(proposalTitle({ ...base, kind: "binding", secretName: "GITHUB_TOKEN", target: { id: "b", name: "CTO", icon: null } } as SecretProposalView)).toEqual({
      who: "Quant Researcher",
      what: "wants CTO to use",
      name: "GITHUB_TOKEN",
    });
  });

  it("gives the reason, task and time", () => {
    expect(proposalMeta(base, new Date("2026-10-27T18:00:00"))).toBe("For liquidation heatmaps · on TRA-41 · today at 10:40 am");
  });
});

describe("per-person secrets", () => {
  it("sums up coverage", () => {
    expect(coverageLabel({ definitionId: "d", configuredCount: 2, missingCount: 1, inactiveCount: 0 })).toBe("2 of 3 people have set it");
    expect(coverageLabel({ definitionId: "d", configuredCount: 0, missingCount: 0, inactiveCount: 0 })).toBe("Nobody needs it yet");
  });

  it("checks and suggests keys", () => {
    expect(keyProblem("")).toMatch(/Enter/);
    expect(keyProblem("has space")).toMatch(/letters/);
    expect(keyProblem("GITHUB_TOKEN")).toBeNull();
    expect(keyFromName("Personal GitHub token!")).toBe("PERSONAL_GITHUB_TOKEN");
  });
});
