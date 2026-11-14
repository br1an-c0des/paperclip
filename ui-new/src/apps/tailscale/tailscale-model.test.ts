import { describe, expect, it } from "vitest";
import type { TailscaleConnection, TailscaleDevice, TailscaleDeviceLogin } from "@/api/tailscale";
import { appsView } from "../apps-model";
import {
  autoConnection,
  canManageTailscale,
  connectedNetworks,
  deviceLabel,
  keepPolling,
  networksSummary,
  networkState,
  pairingPort,
  returnProblem,
  samePairingTarget,
  showsConnectionPicker,
  showsNetworkChoice,
  SIGN_IN_WINDOW_MS,
  signingIn,
  signInDeadline,
  signInStep,
  sortDevices,
  statusLabel,
  withConnection,
} from "./tailscale-model";

const net = (id: string, status: string, name = `Net ${id}`): TailscaleConnection => ({ id, companyId: "c1", name, status });
const device = (overrides: Partial<TailscaleDevice>): TailscaleDevice => ({ id: "d", name: "Box", hostname: "box", address: "100.64.0.1", os: "linux", online: true, ...overrides });
const login = (status: string, extra: Partial<TailscaleDeviceLogin> = {}): TailscaleDeviceLogin => ({ connection: net("n1", status), expiresAt: null, ...extra });

describe("Tailscale access", () => {
  it("is for instance admins and local implicit access", () => {
    expect(canManageTailscale({ source: "local_implicit", isInstanceAdmin: false })).toBe(true);
    expect(canManageTailscale({ source: "session", isInstanceAdmin: true })).toBe(true);
    expect(canManageTailscale({ source: "session", isInstanceAdmin: false })).toBe(false);
    expect(canManageTailscale(undefined)).toBe(false);
  });
});

describe("tailnets", () => {
  it("labels each status and maps it to a connection state", () => {
    expect(statusLabel("connected")).toBe("Connected");
    expect(statusLabel("authorizing")).toBe("Waiting for sign-in");
    expect(statusLabel("expired")).toBe("Sign-in expired");
    expect(statusLabel("whatever")).toBe("Sign-in didn't finish");
    expect(networkState(net("a", "connected")).kind).toBe("connected");
    expect(networkState(net("a", "authorizing")).kind).toBe("draft");
    expect(networkState(net("a", "disconnected")).kind).toBe("paused");
    expect(networkState(net("a", "error")).kind).toBe("attention");
  });

  it("sums them up for Connections", () => {
    expect(networksSummary([])).toBe("Not connected");
    expect(networksSummary([net("a", "authorizing")])).toBe("Waiting for sign-in");
    expect(networksSummary([net("a", "connected", "Home"), net("b", "disconnected"), net("c", "connected", "Lab")])).toBe("Home, Lab · Connected");
    expect(connectedNetworks([net("a", "connected"), net("b", "expired")]).map((row) => row.id)).toEqual(["a"]);
    expect(signingIn([net("a", "connected"), net("b", "authorizing")])).toBe(true);
  });

  it("replaces a connection with its newest state", () => {
    expect(withConnection([net("a", "authorizing"), net("b", "connected")], net("a", "connected"))).toEqual([net("b", "connected"), net("a", "connected")]);
    expect(withConnection(undefined, net("a", "authorizing"))).toEqual([net("a", "authorizing")]);
  });

  it("reads the older OAuth callback's outcome", () => {
    expect(returnProblem(new URLSearchParams("tailscale_error=cancelled"))).toMatch(/cancelled/);
    expect(returnProblem(new URLSearchParams("tailscale_error=failed"))).toMatch(/couldn't be finished/);
    expect(returnProblem(new URLSearchParams("tailscale_connection=n1"))).toBeNull();
  });
});

describe("device sign-in", () => {
  it("expires at the server's deadline, or ten minutes after it was seen", () => {
    expect(signInDeadline({ expiresAt: "2026-11-14T10:10:00.000Z" }, 0)).toBe(Date.parse("2026-11-14T10:10:00.000Z"));
    expect(signInDeadline({ expiresAt: null }, 1000)).toBe(1000 + SIGN_IN_WINDOW_MS);
    expect(signInDeadline(undefined, 5)).toBe(5 + SIGN_IN_WINDOW_MS);
  });

  it("polls only while authorizing, unexpired and answering", () => {
    expect(keepPolling(undefined, false, false)).toBe(true);
    expect(keepPolling(login("authorizing"), false, false)).toBe(true);
    expect(keepPolling(login("connected"), false, false)).toBe(false);
    expect(keepPolling(login("authorizing"), true, false)).toBe(false);
    expect(keepPolling(login("authorizing"), false, true)).toBe(false);
  });

  it("says what it waits for", () => {
    expect(signInStep(login("authorizing"), false)).toBe("waiting");
    expect(signInStep(login("authorizing", { needsApproval: true }), false)).toBe("approval");
    expect(signInStep(login("authorizing", { needsApproval: true }), true)).toBe("expired");
  });
});

describe("the SSH form's machine", () => {
  it("picks a sole connected tailnet, and keeps the picker for more or a stale one", () => {
    expect(autoConnection([net("a", "connected")], "")).toBe("a");
    expect(autoConnection([net("a", "connected")], "a")).toBeNull();
    expect(autoConnection([net("a", "connected"), net("b", "connected")], "")).toBeNull();
    expect(showsConnectionPicker([net("a", "connected")], "a")).toBe(false);
    expect(showsConnectionPicker([net("a", "connected"), net("b", "connected")], "a")).toBe(true);
    expect(showsConnectionPicker([net("a", "connected")], "gone")).toBe(true);
  });

  it("labels and sorts machines, online first", () => {
    expect(deviceLabel(device({ name: "Studio", hostname: "studio.ts.net", os: "macOS" }))).toBe("Studio — studio.ts.net (macOS)");
    expect(deviceLabel(device({ name: "box", hostname: "box", os: "" }))).toBe("box");
    const sorted = sortDevices([device({ id: "1", name: "b", online: false }), device({ id: "2", name: "c" }), device({ id: "3", name: "a" })]);
    expect(sorted.map((entry) => entry.id)).toEqual(["3", "2", "1"]);
  });

  it("ignores a pairing for another tailnet, machine or port", () => {
    const target = { companyId: "c1", connectionId: "n1", deviceId: "d1", port: 22 };
    expect(samePairingTarget(target, { ...target })).toBe(true);
    expect(samePairingTarget(target, { ...target, port: 2222 })).toBe(false);
    expect(samePairingTarget(target, { ...target, deviceId: "d2" })).toBe(false);
    expect(samePairingTarget(null, target)).toBe(false);
    expect(pairingPort("")).toBe(22);
    expect(pairingPort("2222")).toBe(2222);
    expect(pairingPort("99999")).toBe(22);
  });

  it("offers the Network choice once a tailnet is connected, or on a Tailscale environment", () => {
    expect(showsNetworkChoice("direct", true, 0)).toBe(false);
    expect(showsNetworkChoice("direct", true, 1)).toBe(true);
    expect(showsNetworkChoice("direct", false, 1)).toBe(false);
    expect(showsNetworkChoice("tailscale", false, 0)).toBe(true);
  });
});

describe("the Connections address", () => {
  it("opens Tailscale at /connections/tailscale", () => {
    expect(appsView("tailscale")).toEqual({ section: "tailscale" });
  });
});
