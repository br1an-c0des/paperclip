import { A, Navigate, useLocation } from "@solidjs/router";
import { For, Match, Show, Switch } from "solid-js";
import { useCompany } from "@/lib/company";
import { AssistantConnection } from "../assistant/AssistantConnection";
import { GatewayDetail } from "../gateways/GatewayDetail";
import { GatewaysList } from "../gateways/Gateways";
import { PasteConfig } from "./PasteConfig";
import { ProfileDetail } from "./ProfileDetail";
import { ProfilesIndex } from "./Profiles";
import { ProfileWizard } from "./ProfileWizard";
import { isTemplateKey, type WizardStep } from "./profile-model";
import { ADVANCED_TABS, type MoreAppsView } from "./routes-model";
import "./Advanced.css";

/*
 * The Apps pages M6 round 3 adds (routes-model.ts): Assistants, Gateways, and Advanced (pasting an
 * MCP config, access profiles). AppsPage hands them the view for `/:prefix/apps/<rest>`.
 *
 * Advanced isn't gated in the browser: the old UI's gate let every member but viewers in, and the
 * server answers 403 to anyone else, which the pages show.
 */

export function MoreApps(props: { view: MoreAppsView }) {
  const company = useCompany();
  const location = useLocation();
  const search = () => new URLSearchParams(location.search);
  const pick = <S extends MoreAppsView["section"]>(name: S) => (props.view.section === name ? (props.view as Extract<MoreAppsView, { section: S }>) : null);
  const step = (): WizardStep | null => {
    const value = Number(search().get("step"));
    return value === 1 || value === 2 || value === 3 ? value : null;
  };
  const template = () => {
    const value = search().get("template");
    return isTemplateKey(value) ? value : null;
  };
  return (
    <Switch>
      <Match when={pick("redirect")}>{(view) => <Navigate href={`/${company().issuePrefix}/apps${view().to ? `/${view().to}` : ""}`} />}</Match>
      <Match when={pick("assistant")}>
        <AssistantConnection />
      </Match>
      <Match when={pick("gateways")}>
        <GatewaysList />
      </Match>
      <Match when={pick("gateway")}>
        {(view) => (
          // One page per gateway, kept across its tabs (tokens issued here fill its snippets).
          <Show when={view().gatewayId} keyed>
            {(gatewayId) => <GatewayDetail gatewayId={gatewayId} tab={view().tab} />}
          </Show>
        )}
      </Match>
      <Match when={pick("advanced")}>
        {(view) => (
          <>
            <AdvancedTabs active={view().tab} />
            <Switch>
              <Match when={view().tab === "paste-config"}>
                <PasteConfig />
              </Match>
              <Match when={view().tab === "profiles"}>
                <ProfilesIndex checkOpen={search().get("check") === "1"} />
              </Match>
            </Switch>
          </>
        )}
      </Match>
      <Match when={pick("profile-new")}>
        <ProfileWizard template={template()} step={null} />
      </Match>
      <Match when={pick("profile-edit")} keyed>
        {(view) => <ProfileWizard profileId={view.profileId} template={null} step={step()} />}
      </Match>
      <Match when={pick("profile")} keyed>
        {(view) => <ProfileDetail profileId={view.profileId} created={search().get("created") === "1"} review={search().get("review") === "new-tools"} />}
      </Match>
    </Switch>
  );
}

function AdvancedTabs(props: { active: string }) {
  const company = useCompany();
  return (
    <nav class="tl-subtabs" aria-label="Advanced">
      <For each={ADVANCED_TABS}>
        {(tab) => (
          <A href={`/${company().issuePrefix}/apps/advanced/${tab.key}`} activeClass="" inactiveClass="" aria-current={props.active === tab.key ? "page" : undefined}>
            {tab.label}
          </A>
        )}
      </For>
    </nav>
  );
}
