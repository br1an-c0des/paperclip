import type { SlackSetupOptions } from "@paperclipai/shared";
import type { ChatEndpoint } from "@/api/chat-endpoints";

/*
 * Slack's provisioned setups (src/apps/chat/SlackSetup.tsx): which way a new Slack endpoint is set
 * up, what a registration's error code means, and which workspace managed setup uses. The messages
 * are the shared package's `slackRegistrationErrorMessage`, copied (decision 10).
 */

export type SlackMethod = "managed" | "automatic" | "manual" | "existing";

/** Managed and automatic setups create the Slack app for you; manual ones paste a manifest. */
export function isProvisioned(method: string | null | undefined) {
  return method === "automatic" || method === "managed";
}

/** The way a new endpoint starts: the server's default when it offers one, else the manifest. */
export function defaultSlackMethod(options: SlackSetupOptions | undefined): SlackMethod {
  if (!options) return "manual";
  if (options.defaultMethod === "managed" && options.managedAvailable) return "managed";
  return options.defaultMethod === "automatic" ? "automatic" : "manual";
}

const MESSAGES: Record<string, string> = {
  slack_managed_unavailable: "Managed Slack setup is unavailable. Try again later or use your own app before creation starts.",
  slack_manager_reauthorize: "Reconnect your Slack workspace to continue setting up this agent.",
  slack_approval_pending: "Slack is waiting for your workspace administrator to approve this app.",
  slack_approval_required: "Your Slack workspace requires approval. Continue in Slack to request it.",
  slack_approval_denied: "Your Slack administrator declined this installation. Contact them to continue.",
  slack_configuration_token_invalid: "Slack rejected the app configuration access token. Generate a new access token and try again.",
  slack_manifest_invalid: "Slack rejected this app configuration. Check the app details or use manual setup.",
  slack_manifest_update_pending:
    "Your Slack app is saved, but its event settings still need to be applied. Enter an app configuration access token to retry configuring the same app.",
  slack_setup_rate_limited: "Slack is limiting setup requests. Wait a minute and try again.",
  slack_setup_permission_denied: "Slack requires permission to create or install this app. Ask your workspace administrator.",
  slack_creation_uncertain:
    "Slack may have created the app. Check your Slack app settings before trying again, or connect the existing app manually.",
  slack_install_declined: "Installation was not approved. You can install the same app when you are ready.",
  slack_install_expired: "Slack authorization expired. Install the same app again to continue.",
  slack_install_failed: "Slack installation could not be completed. Authorize the same app again.",
  slack_install_identity_mismatch: "Slack returned a different app, workspace, or bot. Install the app created for this connection.",
  slack_install_scopes_missing: "Slack did not grant all required bot permissions. Install the app again and approve its requested permissions.",
  slack_bot_already_connected: "This Slack bot is already connected to Paperclip. Resume its existing connection or use a different app.",
  slack_install_token_invalid: "Slack rejected the saved bot credentials. Continue in Slack to authorize this app again.",
  slack_configuration_incomplete: "The app is installed, but Paperclip could not finish connecting it. Retry connecting the saved installation.",
  slack_install_account_missing: "Slack did not identify your account. Authorize the same app again to connect your Slack account.",
  slack_install_account_conflict:
    "This Slack account already has an existing link. Manage account links in connection settings, or authorize with your own Slack account.",
};

export function slackSetupMessage(code: string): string {
  return MESSAGES[code] ?? "Slack setup could not be completed. Resume setup and try again.";
}

/** Managed setup's wording for a stopped registration. */
export function managedMessage(code: string): string {
  if (code === "slack_manifest_update_pending") return "Your app was created. Retry to finish its configuration.";
  if (code === "slack_creation_uncertain") return "Slack may have created your app. Check Slack app settings before trying again.";
  return slackSetupMessage(code);
}

/**
 * The workspace managed setup will use: the one the registration started with, the one picked, or
 * the only one there is. `authorize` says Slack's manager app must be (re)authorized first.
 */
export function managedWorkspace(endpoint: Pick<ChatEndpoint, "setup">, options: SlackSetupOptions | undefined, picked: string | null) {
  const registration = endpoint.setup?.slackRegistration;
  const workspaces = options?.workspaces ?? [];
  const grantId = registration?.managerGrantId ?? picked ?? (workspaces.length === 1 ? workspaces[0]!.grantId : null);
  const authorize =
    !grantId || registration?.errorCode === "slack_manager_reauthorize" || !workspaces.some((workspace) => workspace.grantId === grantId);
  return { grantId, authorize };
}

/** Which part of automatic setup is next: create the app, install it, or retry a saved install. */
export function automaticStage(endpoint: Pick<ChatEndpoint, "setup">): "create" | "creating" | "uncertain" | "retry-config" | "install" | "resume" {
  const registration = endpoint.setup?.slackRegistration;
  if (registration?.errorCode === "slack_manifest_update_pending") return "retry-config";
  if (registration?.status === "creating") return "creating";
  if (registration?.status === "uncertain") return "uncertain";
  if (!registration?.appId) return "create";
  if (registration.status === "credentials_saved") return "resume";
  return "install";
}
