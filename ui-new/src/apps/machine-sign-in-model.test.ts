import type { MachineSignInPublicKey, MachineSignInStatus, ToolConnection } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import {
  machineCreateInput,
  machineCreateProblem,
  machineMethodLabel,
  machineSignInService,
  machineTestInput,
  machineTestProblem,
  newMachineDraft,
  publicKeyText,
  rotationStage,
  scopesText,
  usesMachineSignIn,
} from "./machine-sign-in-model";

const key: MachineSignInPublicKey = {
  keyId: "kid-1",
  algorithm: "ES256",
  pem: "-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----\n",
  jwk: { kty: "EC", crv: "P-256", x: "x", y: "y" },
  createdAt: "2026-11-14T10:00:00.000Z",
};

const status = (patch: Partial<MachineSignInStatus> = {}): MachineSignInStatus => ({
  connectionId: "c1",
  method: "paperclip_key",
  clientId: null,
  issuer: "https://auth.example.com",
  tokenUrl: "https://auth.example.com/token",
  scopes: [],
  publicKey: key,
  pendingPublicKey: null,
  hasClientSecret: false,
  lastTokenAt: null,
  ...patch,
});

describe("machine sign-in", () => {
  it("knows a machine sign-in connection by its grant", () => {
    expect(usesMachineSignIn({ config: { oauth: { grantType: "client_credentials" } } } as Pick<ToolConnection, "config">)).toBe(true);
    expect(usesMachineSignIn({ config: { oauth: { grantType: "authorization_code" } } } as Pick<ToolConnection, "config">)).toBe(false);
    expect(usesMachineSignIn({ config: {} } as Pick<ToolConnection, "config">)).toBe(false);
    expect(usesMachineSignIn(null)).toBe(false);
  });

  it("checks the draft before creating it", () => {
    const draft = newMachineDraft();
    expect(machineCreateProblem("", draft)).toBe("Paste the server address.");
    expect(machineCreateProblem("https://mcp.example.com/mcp", draft)).toBeNull();
    expect(machineCreateProblem("https://mcp.example.com/mcp", { ...draft, signInService: "auth.example.com" })).toContain("sign-in service's full address");
    // A secret needs its client ID and the secret itself up front; a key can take its ID later.
    const secret = { ...draft, method: "client_secret" as const };
    expect(machineCreateProblem("https://mcp.example.com/mcp", secret)).toBe("Add the client ID.");
    expect(machineCreateProblem("https://mcp.example.com/mcp", { ...secret, clientId: "id" })).toBe("Add the client secret.");
    expect(machineCreateProblem("https://mcp.example.com/mcp", { ...secret, clientId: "id", clientSecret: "s" })).toBeNull();
  });

  it("creates the draft with only what was filled in", () => {
    expect(machineCreateInput(" https://mcp.example.com/mcp ", "", newMachineDraft())).toEqual({
      link: "https://mcp.example.com/mcp",
      name: "mcp.example.com/mcp",
      method: "paperclip_key",
    });
    expect(
      machineCreateInput("https://mcp.example.com/mcp", "Billing", {
        method: "client_secret",
        signInService: " https://auth.example.com ",
        clientId: " id ",
        clientSecret: "s3cret",
        scopes: " read write ",
      }, "app-1"),
    ).toEqual({
      link: "https://mcp.example.com/mcp",
      name: "Billing",
      authorizationServer: "https://auth.example.com",
      method: "client_secret",
      clientId: "id",
      clientSecret: "s3cret",
      scopes: "read write",
      applicationId: "app-1",
    });
    // A key draft never carries a secret, even one left in the field.
    expect(machineCreateInput("https://mcp.example.com/mcp", "x", { ...newMachineDraft(), clientSecret: "left over" })).not.toHaveProperty("clientSecret");
  });

  it("tests with the client ID and scopes, and a secret only as a replacement", () => {
    expect(machineTestInput(status(), " id ", "")).toEqual({ clientId: "id", scopes: "" });
    expect(machineTestInput(status(), "id", "a b", "ignored")).toEqual({ clientId: "id", scopes: "a b" });
    expect(machineTestInput(status({ method: "client_secret" }), "id", "", "new")).toEqual({ clientId: "id", scopes: "", clientSecret: "new" });
    expect(machineTestProblem(" ")).toContain("client ID");
    expect(machineTestProblem("id")).toBeNull();
  });

  it("describes the status without any secret", () => {
    expect(machineMethodLabel(status())).toBe("Paperclip key (ES256)");
    expect(machineMethodLabel(status({ method: "client_secret", publicKey: null }))).toBe("Client secret");
    expect(machineSignInService(status())).toBe("https://auth.example.com");
    expect(machineSignInService(status({ issuer: null }))).toBe("https://auth.example.com/token");
    expect(scopesText(["read", "write"])).toBe("read write");
  });

  it("tracks a key rotation and shows the public key both ways", () => {
    expect(rotationStage(status())).toBe("idle");
    expect(rotationStage(status({ pendingPublicKey: { ...key, keyId: "kid-2" } }))).toBe("pending");
    expect(publicKeyText(key, "pem")).toBe("-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----");
    expect(JSON.parse(publicKeyText(key, "jwk"))).toEqual(key.jwk);
  });
});
