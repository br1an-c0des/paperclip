/*
 * The Apps pages M6 round 3 adds under `/:prefix/apps`, keeping the old UI's addresses
 * (ui/src/App.tsx):
 *
 * - `/apps/assistant-connection`: connect an outside assistant to Paperclip's MCP endpoint.
 * - `/apps/gateways`, `/apps/gateways/:gatewayId/:tab`: named MCP gateways.
 * - `/apps/advanced`, `/apps/advanced/:tab`: pasting an MCP config, and access profiles.
 * - `/apps/advanced/profiles/new`, `…/profiles/:id`, `…/profiles/:id/edit`: a profile and its wizard.
 *
 * The old UI's retired Advanced tabs redirect as it does; the smoke lab (maintainer tooling,
 * decision 12) goes to the profiles.
 */

export type GatewayTab = "overview" | "apps" | "tokens" | "activity" | "advanced";
export const GATEWAY_TABS: { key: GatewayTab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "apps", label: "Apps and tools" },
  { key: "tokens", label: "Tokens" },
  { key: "activity", label: "Activity" },
  { key: "advanced", label: "Advanced" },
];

export type AdvancedTab = "paste-config" | "profiles";
export const ADVANCED_TABS: { key: AdvancedTab; label: string }[] = [
  { key: "paste-config", label: "Paste a config" },
  { key: "profiles", label: "Access profiles" },
];

export type MoreAppsView =
  | { section: "assistant" }
  | { section: "gateways" }
  | { section: "gateway"; gatewayId: string; tab: GatewayTab }
  | { section: "advanced"; tab: AdvancedTab }
  | { section: "profile-new" }
  | { section: "profile-edit"; profileId: string }
  | { section: "profile"; profileId: string }
  /** `to` is relative to `/:prefix/apps`. */
  | { section: "redirect"; to: string };

/** Which of the Apps tabs a page sits under. */
export type MoreAppsTab = "assistant" | "gateways" | "advanced";

const RETIRED_TO_APPS = new Set(["applications", "connections", "overview", "examples", "audit", "runtime", "run-your-own"]);

/** Where `/:prefix/apps/<rest>` goes, when it's one of these pages; null for the rest of Apps. */
export function moreAppsView(rest: string): MoreAppsView | null {
  const parts = rest.split("/").filter(Boolean).map(decodeURIComponent);
  const [first, second, third, fourth] = parts;
  if (first === "assistant-connection") return second ? { section: "redirect", to: "assistant-connection" } : { section: "assistant" };
  if (first === "gateways") {
    if (!second) return { section: "gateways" };
    const tab = GATEWAY_TABS.find((entry) => entry.key === third);
    if (!tab || fourth) return { section: "redirect", to: `gateways/${encodeURIComponent(second)}/overview` };
    return { section: "gateway", gatewayId: second, tab: tab.key };
  }
  if (first !== "advanced") return null;
  if (!second) return { section: "advanced", tab: "paste-config" };
  if (second === "profiles" && third) {
    if (third === "new") return fourth ? { section: "redirect", to: "advanced/profiles/new" } : { section: "profile-new" };
    if (fourth === "edit") return { section: "profile-edit", profileId: third };
    if (fourth) return { section: "redirect", to: `advanced/profiles/${encodeURIComponent(third)}` };
    return { section: "profile", profileId: third };
  }
  if (third) return { section: "redirect", to: "advanced" };
  if (second === "paste-config" || second === "profiles") return { section: "advanced", tab: second };
  if (second === "gateways") return { section: "redirect", to: "gateways" };
  if (second === "policies" || second === "smoke-lab") return { section: "redirect", to: "advanced/profiles" };
  if (RETIRED_TO_APPS.has(second)) return { section: "redirect", to: "" };
  return { section: "redirect", to: "advanced" };
}

export function moreAppsTab(view: MoreAppsView): MoreAppsTab | null {
  switch (view.section) {
    case "assistant":
      return "assistant";
    case "gateways":
    case "gateway":
      return "gateways";
    case "redirect":
      return null;
    default:
      return "advanced";
  }
}
