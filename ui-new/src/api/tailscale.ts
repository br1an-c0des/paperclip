import type { TailscaleConnection, TailscaleDeviceLogin } from "@paperclipai/shared";
import { api } from "./client";

/*
 * The company's Tailscale networks (upstream #20617, #21526; ui/src/api/tailscale.ts,
 * docs/api/tailscale.md). Paperclip joins its own device to a tailnet through device sign-in, then
 * SSH environments pick that tailnet's machines. Only instance admins (or local implicit board
 * access) can use these endpoints.
 *
 * - `connect` starts device sign-in (201): `authorizationUrl` once Tailscale has a sign-in link.
 * - `deviceLogin` resumes a pending sign-in and reads its progress; only its starter may.
 * - `devices` lists the tailnet's machines; an environment saves the stable `id`.
 * - `pairing` makes a fresh SSH key pair, keeps the private key as a company secret and returns a
 *   command that installs the public key on the machine.
 * - `disconnect` stops the network client and cancels a pending sign-in; the record stays.
 */

export type { TailscaleConnection, TailscaleDeviceLogin } from "@paperclipai/shared";

export type TailscaleDevice = { id: string; name: string; hostname: string; address: string; os: string; online: boolean };

export type TailscalePairing = { privateKeySecretId: string; publicKey: string; command: string };

const base = (companyId: string) => `/companies/${encodeURIComponent(companyId)}/tailscale-connections`;
const one = (companyId: string, connectionId: string) => `${base(companyId)}/${encodeURIComponent(connectionId)}`;

export const tailscaleApi = {
  list: (companyId: string, signal?: AbortSignal) => api.get<TailscaleConnection[]>(base(companyId), { signal }),
  connect: (companyId: string, connectionId?: string) =>
    api.post<TailscaleDeviceLogin>(base(companyId), { name: "My tailnet", ...(connectionId ? { connectionId } : {}) }),
  deviceLogin: (companyId: string, connectionId: string) => api.post<TailscaleDeviceLogin>(`${one(companyId, connectionId)}/device-login`, {}),
  devices: (companyId: string, connectionId: string, signal?: AbortSignal) =>
    api.get<TailscaleDevice[]>(`${one(companyId, connectionId)}/devices`, { signal }),
  disconnect: (companyId: string, connectionId: string) => api.delete<TailscaleConnection>(one(companyId, connectionId)),
  pairing: (companyId: string, connectionId: string, deviceId: string, port: number) =>
    api.post<TailscalePairing>(`${one(companyId, connectionId)}/pairing`, { deviceId, port }),
};
