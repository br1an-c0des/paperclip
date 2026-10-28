import type { InstanceExperimentalSettingsWithManaged } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { Check, Lock } from "lucide-solid";
import { createMemo, For, Show } from "solid-js";
import { accessApi } from "@/api/access";
import { instanceSettingsApi } from "@/api/instance-settings";
import { queryKeys } from "@/api/queryKeys";
import { useExperimentalSettingsQuery } from "@/lib/company-data";
import { SettingsCard } from "@/ui/Field";
import { Switch } from "@/ui/Switch";
import { featurePatch, featureRowState, linkedNote, visibleFeatureGroups, type FeatureContext, type FeatureFlag } from "./features-model";
import { SaveNote, useSaver } from "./shared";
import "./FeaturesCard.css";

/*
 * App settings → General → Features (decision 32; features-model.ts has the list and its rules):
 * instance-wide switches for the features the server turns on or off. Each change saves at once
 * (`PATCH /api/instance/settings/experimental`) and shows straight away; a failed save puts the
 * switch back and says why. Afterwards every query is marked stale, since a flag can change what
 * any page gets from the API, and the ones on screen refetch.
 *
 * General is shown to instance admins only. The switches check again and are read-only for anyone
 * else, as the server refuses the change.
 */

export function FeaturesCard(props: { hidden: ReadonlySet<string> }) {
  const client = useQueryClient();
  const experimental = useExperimentalSettingsQuery();
  const access = createQuery(() => ({ queryKey: queryKeys.access.currentBoardAccess, queryFn: accessApi.currentBoardAccess }));
  const saver = useSaver();
  const groups = createMemo(() => visibleFeatureGroups(props.hidden));
  const context = (): FeatureContext => ({
    settings: experimental.data,
    hidden: props.hidden,
    editable: access.data?.isInstanceAdmin === true && !saver.busy(),
  });

  const change = (flag: FeatureFlag, value: boolean) => {
    const before = experimental.data;
    if (!before) return;
    const patch = featurePatch(flag, value, before);
    client.setQueryData<InstanceExperimentalSettingsWithManaged>(queryKeys.instance.experimentalSettings, { ...before, ...patch });
    void saver.run(async () => {
      try {
        const saved = await instanceSettingsApi.updateExperimental(patch);
        client.setQueryData<InstanceExperimentalSettingsWithManaged>(queryKeys.instance.experimentalSettings, (current) => ({
          ...saved,
          managedKeys: saved.managedKeys ?? current?.managedKeys,
        }));
      } catch (caught) {
        client.setQueryData(queryKeys.instance.experimentalSettings, before);
        throw caught;
      }
      void client.invalidateQueries();
    }, "Couldn't change the feature.");
  };

  return (
    <Show when={groups().length}>
      <SettingsCard
        title="Features"
        description={
          <SaveNote saver={saver}>
            Features the server turns on or off for every organization. They're still experimental and may change.
            <Show when={access.data && !access.data.isInstanceAdmin}> Only instance admins can change them.</Show>
          </SaveNote>
        }
      >
        <Show
          when={!experimental.isError}
          fallback={<div class="as-empty-line">Couldn't load the features. {experimental.error instanceof Error ? experimental.error.message : ""}</div>}
        >
          <For each={groups()}>
            {(group, index) => (
              <div class="ft-group" role="group" aria-labelledby={`ft-group-${index()}`}>
                <h4 class="ft-group-title lbl" id={`ft-group-${index()}`}>
                  {group.title}
                </h4>
                <For each={group.flags}>{(flag) => <FeatureRow flag={flag} context={context()} onChange={(value) => change(flag, value)} />}</For>
              </div>
            )}
          </For>
        </Show>
      </SettingsCard>
    </Show>
  );
}

function FeatureRow(props: { flag: FeatureFlag; context: FeatureContext; onChange: (value: boolean) => void }) {
  const state = createMemo(() => featureRowState(props.flag, props.context));
  const also = () => linkedNote(props.flag, props.context.settings);
  return (
    <div class="frow as-frow-switch ft-row">
      <div class="flabel">
        <span class="ft-name">
          {props.flag.label}
          <Show when={state().managed}>
            <span class="as-chip ft-managed">
              <Lock size={11} aria-hidden="true" />
              Managed by Paperclip Cloud
            </span>
          </Show>
        </span>
        <span class="fhelp">{props.flag.help}</span>
        <Show when={state().requirements.length}>
          <span class="ft-needs">
            Needs
            <For each={state().requirements}>
              {(requirement) => (
                <span class="ft-need" classList={{ "ft-need--off": !requirement.on }}>
                  <Show when={requirement.on}>
                    <Check size={11} aria-hidden="true" />
                  </Show>
                  {requirement.label}
                  <span class="sr-only">{requirement.on ? " (on)" : " (off)"}</span>
                </span>
              )}
            </For>
          </span>
        </Show>
        <Show when={!state().managed && (state().note ?? also())}>{(text) => <span class="fhelp ft-note">{text()}</span>}</Show>
      </div>
      <Switch checked={state().checked} disabled={state().disabled} onChange={props.onChange} label={props.flag.label} labelHidden />
    </div>
  );
}
