import type { CurrentBoardAccess } from "@/api/access";
import type { TailscaleConnection, TailscaleDevice, TailscaleDeviceLogin } from "@/api/tailscale";
import type { ConnectionState } from "../apps-model";

/*
 * Tailscale networks (U156; upstream #20617 and #21526, the old UI's /apps/tailscale page and
 * TailscaleSshMachine). In ui-new the page is Connections → Tailscale (`/:prefix/connections/tailscale`),
 * and the SSH environment form picks a tailnet's machine (settings/company/EnvironmentDialog.tsx).
 *
 * Only instance admins, or local implicit board access, manage tailnets: the server refuses everyone
 * else, so the entry and the form's Network choice don't show for them.
 */

export const TAILSCALE_LOGO = "/brands/apps/tailscale.png";

/** Device sign-in lasts ten minutes; the server's `expiresAt` wins when it sends one. */
export const SIGN_IN_WINDOW_MS = 10 * 60_000;

/** How often a pending sign-in is checked while it waits. */
export const SIGN_IN_POLL_MS = 2000;

export function canManageTailscale(access: Pick<CurrentBoardAccess, "source" | "isInstanceAdmin"> | null | undefined) {
  return access?.source === "local_implicit" || access?.isInstanceAdmin === true;
}

export function connectedNetworks(connections: readonly TailscaleConnection[] | undefined) {
  return (connections ?? []).filter((connection) => connection.status === "connected");
}

/** A sign-in is under way: a new one can't start until it finishes or is cancelled. */
export function signingIn(connections: readonly TailscaleConnection[] | undefined) {
  return (connections ?? []).some((connection) => connection.status === "authorizing");
}

const STATUS_LABEL: Record<string, string> = {
  connected: "Connected",
  authorizing: "Waiting for sign-in",
  connecting: "Connecting",
  pending: "Sign-in not finished",
  disconnected: "Disconnected",
  expired: "Sign-in expired",
  error: "Sign-in didn't finish",
};

export function statusLabel(status: string) {
  return STATUS_LABEL[status] ?? "Sign-in didn't finish";
}

/** A tailnet's state as Connections shows a connection's: green connected, amber when it needs you. */
export function networkState(connection: Pick<TailscaleConnection, "status">): ConnectionState {
  const label = statusLabel(connection.status);
  if (connection.status === "connected") return { kind: "connected", label, tone: "green", message: null };
  if (connection.status === "authorizing" || connection.status === "connecting") return { kind: "draft", label, tone: "amber", message: null };
  if (connection.status === "disconnected") return { kind: "paused", label, tone: null, message: null };
  return { kind: "attention", label, tone: "amber", message: null };
}

/** The Connections entry's line: which tailnets are connected, or what's going on. */
export function networksSummary(connections: readonly TailscaleConnection[] | undefined) {
  const connected = connectedNetworks(connections);
  if (connected.length) return `${connected.map((connection) => connection.name).join(", ")} · Connected`;
  if (signingIn(connections)) return "Waiting for sign-in";
  return "Not connected";
}

/** What the page says after Tailscale sends you back (`?tailscale_error=` from the older OAuth callback). */
export function returnProblem(search: URLSearchParams) {
  const outcome = search.get("tailscale_error");
  if (outcome === "cancelled") return "Tailscale sign-in was cancelled. Try again to connect your network.";
  if (outcome === "failed") return "Tailscale sign-in couldn't be finished. Try again.";
  return null;
}

/** When a pending sign-in stops: the server's deadline, or ten minutes from when it was seen. */
export function signInDeadline(login: Pick<TailscaleDeviceLogin, "expiresAt"> | undefined, seenAt: number) {
  const parsed = login?.expiresAt ? Date.parse(login.expiresAt) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : seenAt + SIGN_IN_WINDOW_MS;
}

/** Keep checking a sign-in while it's authorizing, hasn't expired and the last check worked. */
export function keepPolling(login: TailscaleDeviceLogin | undefined, expired: boolean, failed: boolean) {
  if (expired || failed) return false;
  return !login || login.connection.status === "authorizing";
}

export type SignInStep = "expired" | "approval" | "waiting";

export function signInStep(login: TailscaleDeviceLogin | undefined, expired: boolean): SignInStep {
  if (expired) return "expired";
  return login?.needsApproval ? "approval" : "waiting";
}

/** Puts a connection's newest state in the list, replacing the one with its id. */
export function withConnection(list: readonly TailscaleConnection[] | undefined, next: TailscaleConnection) {
  return [...(list ?? []).filter((row) => row.id !== next.id), next];
}

// ---------------------------------------------------------------------------------------------
// The SSH environment form's machine

/**
 * A sole connected tailnet is picked for you, and its picker hidden. More than one stays a choice,
 * and so does a saved connection that's no longer the connected one.
 */
export function autoConnection(connected: readonly TailscaleConnection[], current: string) {
  return !current && connected.length === 1 ? connected[0]!.id : null;
}

export function showsConnectionPicker(connected: readonly TailscaleConnection[], current: string) {
  if (connected.length > 1) return true;
  return Boolean(current && !connected.some((connection) => connection.id === current));
}

/** "Studio Mac — studio.tail1234.ts.net (macOS)", "· offline" when it isn't reachable. */
export function deviceLabel(device: TailscaleDevice) {
  const host = device.hostname && device.hostname !== device.name ? ` — ${device.hostname}` : "";
  return `${device.name}${host}${device.os ? ` (${device.os})` : ""}`;
}

/** Online machines first, each by name. */
export function sortDevices(devices: readonly TailscaleDevice[] | undefined) {
  return [...(devices ?? [])].sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
}

export type PairingTarget = { companyId: string; connectionId: string; deviceId: string; port: number };

/**
 * A pairing result belongs to the company, tailnet, machine and port it was made for: a late answer
 * for an earlier choice must not set the private key.
 */
export function samePairingTarget(a: PairingTarget | null | undefined, b: PairingTarget) {
  return !!a && a.companyId === b.companyId && a.connectionId === b.connectionId && a.deviceId === b.deviceId && a.port === b.port;
}

/** The SSH port a pairing is for: the form's, or 22. */
export function pairingPort(port: string) {
  const value = Number(port || "22");
  return Number.isInteger(value) && value >= 1 && value <= 65535 ? value : 22;
}

/** The Network choice shows once a tailnet is connected, or when the environment already uses Tailscale. */
export function showsNetworkChoice(network: "direct" | "tailscale", canManage: boolean, connected: number) {
  return network === "tailscale" || (canManage && connected > 0);
}
