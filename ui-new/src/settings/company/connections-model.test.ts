import type { AgentObservabilitySettings, AiManagedConnectionSummary, DecisionModelSettings, FastResponseSettings } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import {
  decisionDirty,
  decisionDraft,
  decisionTestSummary,
  fastDraft,
  fastModelFor,
  fastProblem,
  headerRow,
  injectionProblem,
  telemetryDirty,
  telemetryDraft,
  telemetryRequest,
  telemetryStatus,
} from "./connections-model";

const REVISION = "6f1d1c7a-6a4f-4b8e-9c2f-0d7d6c1e2a11";
const PROJECT = "0f8fad5b-d9cb-469f-a165-70867728950e";
const CONNECTION = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

function connection(overrides: Partial<AiManagedConnectionSummary> = {}): AiManagedConnectionSummary {
  return {
    id: CONNECTION,
    grantId: "g1",
    companyId: "c",
    provider: "openrouter",
    method: "api_key",
    name: "OpenRouter, shared",
    ownership: "shared",
    isDefault: false,
    status: "connected",
    ...overrides,
  };
}

function otlpSettings(overrides: Partial<AgentObservabilitySettings> = {}): AgentObservabilitySettings {
  return {
    companyId: "c",
    revision: REVISION,
    enabled: true,
    destination: { provider: "otlp", endpointBaseUrl: "https://otel.example.com:4318" },
    capture: { userPrompts: true, assistantResponses: true, toolDetails: true, toolContent: true },
    credentialsConfigured: true,
    headerNames: ["authorization"],
    updatedAt: "2026-10-27T00:00:00Z",
    lastTest: null,
    ...overrides,
  };
}

describe("decision model", () => {
  const settings: DecisionModelSettings = { companyId: "c", enabled: false, allowBackground: true, connectionId: null, grantId: null, provider: null, model: null };

  it("is clean until something changes", () => {
    const draft = decisionDraft(settings);
    expect(decisionDirty(settings, draft)).toBe(false);
    expect(decisionDirty(settings, { ...draft, allowBackground: false })).toBe(true);
  });

  it("explains a failed test", () => {
    expect(decisionTestSummary({ status: "unavailable", reason: "disabled" }).ok).toBe(false);
    expect(decisionTestSummary({ status: "unavailable", reason: "disabled" }).text).toMatch(/Turn decisions on/);
    expect(decisionTestSummary({ status: "failed", invocationId: "x", errorCode: "weird", usage: {} as never }).text).toMatch(/Costs/);
    expect(decisionTestSummary({ status: "succeeded", invocationId: "x", answers: {}, usage: {} as never }).ok).toBe(true);
  });
});

describe("fast responses", () => {
  const settings: FastResponseSettings = { companyId: "c", enabled: false, connectionId: null, grantId: null, provider: null, model: null, allowSponsored: true };

  it("starts an OpenRouter connection on the default model", () => {
    expect(fastModelFor(connection())).toBe("openai/gpt-oss-120b");
    expect(fastModelFor(connection({ provider: "openai" }))).toBeNull();
  });

  it("needs a working connection and a model to turn on", () => {
    const draft = fastDraft(settings);
    expect(fastProblem(draft, undefined)).toBeNull();
    expect(fastProblem({ ...draft, enabled: true }, undefined)).toMatch(/connection/);
    expect(fastProblem({ ...draft, enabled: true, connectionId: CONNECTION, grantId: "g1", model: " " }, connection())).toMatch(/model/);
    expect(fastProblem({ ...draft, enabled: true, connectionId: CONNECTION, grantId: "g1", model: "m" }, connection({ status: "expired" }))).toMatch(/isn't working/);
    expect(fastProblem({ ...draft, enabled: true, connectionId: CONNECTION, grantId: "g1", model: "m" }, connection())).toBeNull();
  });
});

describe("prompt injection check", () => {
  it("refuses the openrouter/ prefix and an unconnected switch-on", () => {
    expect(injectionProblem({ enabled: false, connectionId: null, grantId: null, model: "openrouter/x" }, undefined)).toMatch(/prefix/);
    expect(injectionProblem({ enabled: true, connectionId: null, grantId: null, model: "x" }, undefined)).toMatch(/Choose/);
    expect(injectionProblem({ enabled: false, connectionId: null, grantId: null, model: "x" }, undefined)).toBeNull();
  });
});

describe("run telemetry", () => {
  it("starts a new setup as OTLP and isn't dirty until typed in", () => {
    const draft = telemetryDraft(null);
    expect(draft.provider).toBe("otlp");
    expect(telemetryDirty(null, draft)).toBe(false);
    expect(telemetryDirty(null, { ...draft, endpoint: "https://x" })).toBe(true);
  });

  it("checks the endpoint", () => {
    const draft = telemetryDraft(null);
    expect(telemetryRequest(null, { ...draft, endpoint: "otel" })).toEqual({ problem: expect.stringMatching(/base URL/) });
    expect(telemetryRequest(null, { ...draft, endpoint: "https://otel.example.com/v1/traces" })).toEqual({ problem: expect.stringMatching(/without \/v1/) });
    expect(telemetryRequest(null, { ...draft, endpoint: "https://u:p@otel.example.com" })).toEqual({ problem: expect.stringMatching(/username/) });
  });

  it("builds a new OTLP setup with its headers", () => {
    const draft = { ...telemetryDraft(null), endpoint: "https://otel.example.com:4318", headers: [{ ...headerRow("X-Key"), value: "s3cret" }] };
    expect(telemetryRequest(null, draft)).toEqual({
      request: {
        expectedRevision: null,
        enabled: true,
        capture: draft.capture,
        destination: { provider: "otlp", endpointBaseUrl: "https://otel.example.com:4318" },
        credentials: { mode: "replace", headers: [{ name: "X-Key", value: "s3cret" }] },
      },
    });
  });

  it("keeps saved headers when only the switch changes", () => {
    const settings = otlpSettings();
    const draft = telemetryDraft(settings);
    expect(telemetryDirty(settings, draft)).toBe(false);
    const result = telemetryRequest(settings, draft, false);
    expect(result).toMatchObject({ request: { enabled: false, credentials: { mode: "keep" }, expectedRevision: REVISION } });
  });

  it("asks for header values again on a new origin", () => {
    const settings = otlpSettings();
    const draft = { ...telemetryDraft(settings), endpoint: "https://other.example.com" };
    expect(telemetryRequest(settings, draft)).toEqual({ problem: expect.stringMatching(/type every header value again/) });
  });

  it("needs a Braintrust project ID and key", () => {
    const draft = { ...telemetryDraft(null), provider: "braintrust" as const };
    expect(telemetryRequest(null, draft)).toEqual({ problem: expect.stringMatching(/project ID/) });
    expect(telemetryRequest(null, { ...draft, projectId: PROJECT })).toEqual({ problem: expect.stringMatching(/API key/) });
    expect(telemetryRequest(null, { ...draft, projectId: PROJECT, apiKey: "k" })).toMatchObject({
      request: { destination: { provider: "braintrust", projectId: PROJECT }, credentials: { mode: "replace", apiKey: "k" } },
    });
  });

  it("sums up the status", () => {
    expect(telemetryStatus(null).label).toBe("Not set up");
    expect(telemetryStatus(otlpSettings({ enabled: false })).label).toBe("Off");
    expect(telemetryStatus(otlpSettings()).label).toBe("Sending");
    expect(telemetryStatus(otlpSettings({ lastTest: { status: "failed" } as never })).tone).toBe("red");
  });
});
