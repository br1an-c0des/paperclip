import { api } from "./client";

/*
 * Claiming an instance and approving the CLI, as ui/src/api/access.ts uses them:
 *
 * - Board claim (`/board-claim/:token?code=`): a link the server prints when an instance moves from
 *   local_trusted to authenticated; claiming makes the signed-in user its instance admin.
 * - Bootstrap claim (`POST /bootstrap/claim`): on a private authenticated instance with no admin yet,
 *   the first signed-in user claims it from the browser.
 * - CLI auth (`/cli-auth/:id?token=`): `paperclipai auth login` opens this to have a signed-in
 *   person approve a board API key for the terminal.
 */

export type BoardClaimStatus = {
  status: "available" | "claimed" | "expired";
  requiresSignIn: boolean;
  expiresAt: string | null;
  claimedByUserId: string | null;
};

export type CliAuthChallenge = {
  id: string;
  status: "pending" | "approved" | "cancelled" | "expired";
  command: string;
  clientName: string | null;
  requestedAccess: "board" | "instance_admin_required";
  requestedCompanyId: string | null;
  requestedCompanyName: string | null;
  approvedAt: string | null;
  cancelledAt: string | null;
  expiresAt: string;
  approvedByUser: { id: string; name: string; email: string } | null;
  requiresSignIn: boolean;
  canApprove: boolean;
  currentUserId: string | null;
};

const enc = encodeURIComponent;

export const claimsApi = {
  boardClaim: (token: string, code: string) => api.get<BoardClaimStatus>(`/board-claim/${enc(token)}?code=${enc(code)}`),
  claimBoard: (token: string, code: string) => api.post<{ claimed: true; userId: string }>(`/board-claim/${enc(token)}/claim`, { code }),
  claimBootstrapAdmin: () => api.post<{ claimed: true; userId: string }>("/bootstrap/claim", {}),

  cliChallenge: (id: string, token: string) => api.get<CliAuthChallenge>(`/cli-auth/challenges/${enc(id)}?token=${enc(token)}`),
  approveCli: (id: string, token: string) =>
    api.post<{ approved: boolean; status: string; userId: string; keyId: string | null; expiresAt: string }>(`/cli-auth/challenges/${enc(id)}/approve`, { token }),
  cancelCli: (id: string, token: string) => api.post<{ cancelled: boolean; status: string }>(`/cli-auth/challenges/${enc(id)}/cancel`, { token }),
};
