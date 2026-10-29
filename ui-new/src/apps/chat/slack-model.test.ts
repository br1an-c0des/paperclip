import { describe, expect, it } from "vitest";
import type { ChatEndpoint } from "@/api/chat-endpoints";
import { photonCredentials } from "./chat-model";
import { automaticStage, defaultSlackMethod, isProvisioned, managedMessage, managedWorkspace, slackSetupMessage } from "./slack-model";
import { defaultsPayload, projectKey, withProject, withWorkspace, workspaceChoices, workspaceKey } from "./task-defaults-model";

const withRegistration = (registration: Record<string, unknown> | null, extra: Record<string, unknown> = {}) =>
  ({ setup: { step: "provider_setup", slackRegistration: registration, ...extra } }) as unknown as ChatEndpoint;

describe("Slack setup", () => {
  it("starts with the server's default way, falling back to the manifest", () => {
    expect(defaultSlackMethod(undefined)).toBe("manual");
    expect(defaultSlackMethod({ managedAvailable: true, defaultMethod: "managed", workspaces: [] })).toBe("managed");
    expect(defaultSlackMethod({ managedAvailable: false, defaultMethod: "managed", workspaces: [] })).toBe("manual");
    expect(defaultSlackMethod({ managedAvailable: false, defaultMethod: "automatic", workspaces: [] })).toBe("automatic");
    expect(isProvisioned("managed")).toBe(true);
    expect(isProvisioned("existing")).toBe(false);
  });

  it("explains error codes, with a fallback", () => {
    expect(slackSetupMessage("slack_install_expired")).toMatch(/expired/);
    expect(slackSetupMessage("nope")).toMatch(/Resume setup/);
    expect(managedMessage("slack_creation_uncertain")).toMatch(/may have created/);
  });

  it("picks the managed workspace and says when Slack must be authorized first", () => {
    const options = { managedAvailable: true, defaultMethod: "managed" as const, workspaces: [{ grantId: "g1", workspaceId: "w", workspaceName: "Acme", userId: "u" }] };
    expect(managedWorkspace(withRegistration(null), options, null)).toEqual({ grantId: "g1", authorize: false });
    expect(managedWorkspace(withRegistration(null), { ...options, workspaces: [] }, null)).toEqual({ grantId: null, authorize: true });
    expect(managedWorkspace(withRegistration({ status: "failed", managerGrantId: "g1", errorCode: "slack_manager_reauthorize" }), options, null).authorize).toBe(true);
  });

  it("follows the automatic setup's registration", () => {
    expect(automaticStage(withRegistration(null))).toBe("create");
    expect(automaticStage(withRegistration({ status: "creating" }))).toBe("creating");
    expect(automaticStage(withRegistration({ status: "uncertain" }))).toBe("uncertain");
    expect(automaticStage(withRegistration({ status: "install", appId: "A1" }))).toBe("install");
    expect(automaticStage(withRegistration({ status: "credentials_saved", appId: "A1" }))).toBe("resume");
    expect(automaticStage(withRegistration({ status: "install", appId: "A1", errorCode: "slack_manifest_update_pending" }))).toBe("retry-config");
  });
});

describe("Photon", () => {
  it("sends the shared line or the picked number once the inspection allows it", () => {
    expect(photonCredentials(null, "p", "s", "l")).toBeNull();
    expect(photonCredentials({ allocation: "dedicated", eligible: false }, "p", "s", "l")).toBeNull();
    expect(photonCredentials({ allocation: "shared", eligible: true }, " p ", "s", "")).toEqual({ projectId: "p", projectSecret: "s", allocation: "shared" });
    expect(photonCredentials({ allocation: "dedicated", eligible: true }, "p", "s", "")).toBeNull();
    expect(photonCredentials({ allocation: "dedicated", eligible: true }, "p", "s", "l1")).toEqual({ projectId: "p", projectSecret: "s", lineId: "l1", allocation: "dedicated" });
  });
});

describe("task defaults", () => {
  const choices = workspaceChoices([{ workspaces: [{ id: "w1" }] } as never], [{ id: "x1" }]);

  it("offers task folders, project checkouts and existing workspaces", () => {
    expect([...choices.keys()]).toEqual(["task", "source:w1:managed_isolated", "source:w1:shared", "existing:x1"]);
    expect(workspaceKey(choices.get("source:w1:shared"))).toBe("source:w1:shared");
    expect(workspaceKey(undefined)).toBe("inherit");
    expect(workspaceKey(null)).toBe("clear");
  });

  it("inherits, clears or sets each part", () => {
    expect(projectKey(withProject({}, "none"))).toBe("none");
    expect(withProject({ projectId: "p" }, "inherit")).toEqual({});
    expect(withWorkspace({}, "clear", choices)).toEqual({ workspace: null });
    expect(withWorkspace({}, "existing:x1", choices)).toEqual({ workspace: { kind: "existing", workspaceId: "x1" } });
    expect(defaultsPayload({})).toBeNull();
  });
});
