import type { CompanySecret, CompanySecretProviderConfig, SecretProposalView } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import {
  applyCandidate,
  consumerLabel,
  coverageLabel,
  discoveryQuery,
  emptyVaultForm,
  importableVaults,
  importDraft,
  importDraftProblem,
  importKey,
  importResultLine,
  keyFromName,
  keyProblem,
  listedProviders,
  organizationSecrets,
  proposalMeta,
  proposalTitle,
  secretCounts,
  storedIn,
  usesLabel,
  vaultBlockReason,
  vaultConfig,
  vaultForm,
  vaultProblem,
  vaultStatus,
} from "./secrets-model";

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

describe("vaults", () => {
  const awsConfig = {
    id: "v1",
    provider: "aws_secrets_manager",
    displayName: "Prod AWS",
    status: "ready",
    isDefault: false,
    config: { region: "us-east-1", namespace: "prod", secretNamePrefix: null },
    healthStatus: null,
    healthMessage: null,
  } as unknown as CompanySecretProviderConfig;

  it("round-trips an AWS vault, sending blank optional fields as null", () => {
    const form = vaultForm(awsConfig);
    expect(form.fields).toEqual({ region: "us-east-1", namespace: "prod" });
    expect(vaultConfig({ ...form, fields: { ...form.fields, kmsKeyId: "  " } })).toEqual({
      region: "us-east-1",
      namespace: "prod",
      secretNamePrefix: null,
      kmsKeyId: null,
      ownerTag: null,
      environmentTag: null,
    });
  });

  it("needs a name, AWS's region and the Paperclip vault's backup note", () => {
    expect(vaultProblem(emptyVaultForm("aws_secrets_manager"))).toBe("Give the vault a name.");
    expect(vaultProblem({ ...emptyVaultForm("aws_secrets_manager"), displayName: "A" })).toBe("Enter the AWS region.");
    expect(vaultProblem({ ...emptyVaultForm("local_encrypted"), displayName: "Local" })).toMatch(/back it up/);
    expect(vaultConfig({ ...emptyVaultForm("local_encrypted"), backupReminderAcknowledged: true })).toEqual({ backupReminderAcknowledged: true });
    expect(vaultStatus("vault")).toBe("coming_soon");
    expect(vaultStatus("aws_secrets_manager")).toBe("ready");
  });

  it("says why a vault can't take secrets, and which can be imported from", () => {
    expect(vaultBlockReason({ status: "disabled", healthStatus: null, healthMessage: null })).toMatch(/off/);
    expect(vaultBlockReason({ status: "ready", healthStatus: "error", healthMessage: "No access" })).toBe("No access");
    expect(vaultBlockReason({ status: "warning", healthStatus: "warning", healthMessage: null })).toBeNull();
    expect(importableVaults([awsConfig, { ...awsConfig, id: "v2", status: "disabled" }, { ...awsConfig, id: "v3", provider: "vault" }]).map((config) => config.id)).toEqual(["v1"]);
  });

  it("takes a discovered candidate's routing, keeping a typed name", () => {
    const candidate = { provider: "aws_secrets_manager", displayName: "paperclip/prod", config: { region: "eu-west-1", secretNamePrefix: "pc" } } as never;
    expect(applyCandidate({ ...emptyVaultForm("aws_secrets_manager"), displayName: "Mine" }, candidate)).toMatchObject({
      displayName: "Mine",
      fields: { region: "eu-west-1", secretNamePrefix: "pc", namespace: "" },
    });
    expect(applyCandidate(emptyVaultForm("aws_secrets_manager"), candidate).displayName).toBe("paperclip/prod");
    expect(discoveryQuery({ ...emptyVaultForm("aws_secrets_manager"), fields: { namespace: "prod", ownerTag: "me" } })).toBe("prod");
  });
});

describe("importing a vault's secrets", () => {
  const candidate = (externalRef: string, name: string, key: string) =>
    ({ externalRef, remoteName: name, name, key, providerVersionRef: null, providerMetadata: null, status: "ready", importable: true, conflicts: [] }) as never;

  it("checks names and keys against existing secrets and the other rows", () => {
    const one = importDraft(candidate("arn:1", "Stripe key", "stripe-key"));
    const two = { ...importDraft(candidate("arn:2", "Other", "other")), key: "stripe-key" };
    expect(importDraftProblem(one, [secret({ name: "Stripe key" })], [one])).toMatch(/already has this name/);
    expect(importDraftProblem(two, [], [one, two])).toMatch(/Another selected/);
    expect(importDraftProblem({ ...one, key: "Bad Key" }, [], [one])).toMatch(/lowercase/);
    expect(importDraftProblem(one, [], [one])).toBeNull();
    expect(importKey("Prod/Stripe Key")).toBe("prod-stripe-key");
    expect(importResultLine({ importedCount: 2, skippedCount: 1, errorCount: 0 })).toBe("2 imported · 1 skipped · 0 failed");
  });

  it("names who read a secret", () => {
    expect(consumerLabel("agent_api")).toBe("Agent API");
    expect(consumerLabel("agent")).toBe("Agent");
  });
});
