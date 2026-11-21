import type { InstanceExperimentalSettingsWithManaged, WorktreeCleanupMode } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { Check, Lock } from "lucide-solid";
import { createMemo, For, Show } from "solid-js";
import { accessApi } from "@/api/access";
import { instanceSettingsApi } from "@/api/instance-settings";
import { queryKeys } from "@/api/queryKeys";
import { useExperimentalSettingsQuery } from "@/lib/company-data";
import { SettingsCard } from "@/ui/Field";
import { InfoTip } from "@/ui/InfoTip";
import { Switch } from "@/ui/Switch";
import {
  featurePatch,
  featureRowState,
  linkedNote,
  visibleFeatureGroups,
  worktreeCleanupInfo,
  worktreeCleanupNote,
  worktreeCleanupOptions,
  type FeatureContext,
  type FeatureFlag,
} from "./features-model";
import { SaveNote, saveNote, useSaver } from "./shared";
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

  // The worktree cleanup choice saves like a switch, then rereads what's in force.
  const changeCleanup = (mode: WorktreeCleanupMode) => {
    void saver.run(async () => {
      const saved = await instanceSettingsApi.updateExperimental({ worktreeCleanup: mode });
      client.setQueryData<InstanceExperimentalSettingsWithManaged>(queryKeys.instance.experimentalSettings, (current) => ({
        ...saved,
        managedKeys: saved.managedKeys ?? current?.managedKeys,
      }));
      await client.invalidateQueries({ queryKey: queryKeys.instance.worktreeCleanup });
    }, "Couldn't change worktree cleanup.");
  };

  return (
    <Show when={groups().length}>
      <SettingsCard
        title="Features"
        info="Features the server turns on or off for every organization; they replace the old Experimental page. They're still experimental and may change."
        description={
          access.data && !access.data.isInstanceAdmin ? (
            <SaveNote saver={saver}>Only instance admins can change them.</SaveNote>
          ) : (
            saveNote(saver)
          )
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
                <Show when={group.worktreeCleanup}>
                  <WorktreeCleanupRow editable={context().editable} onChange={(mode) => changeCleanup(mode)} />
                </Show>
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
          <span class="info-line">
            {props.flag.label}
            <InfoTip label={`About ${props.flag.label}`}>{props.flag.help}</InfoTip>
          </span>
          <Show when={state().managed}>
            <span class="as-chip ft-managed">
              <Lock size={11} aria-hidden="true" />
              Managed by Paperclip Cloud
            </span>
          </Show>
        </span>
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

/*
 * Clean up finished worktrees (step 4b part 3): upstream's sweep, off by default, in either of its
 * modes. What each does, with the day counts in force, sits behind the "i"; the line below says only
 * state: the environment fallback, a dry run, or why restore points can't be chosen.
 */
function WorktreeCleanupRow(props: { editable: boolean; onChange: (mode: WorktreeCleanupMode) => void }) {
  const status = createQuery(() => ({
    queryKey: queryKeys.instance.worktreeCleanup,
    queryFn: () => instanceSettingsApi.worktreeCleanup(),
  }));
  const options = createMemo(() => worktreeCleanupOptions(status.data));
  const note = () => (status.isError ? `Couldn't read the cleanup setting. ${status.error instanceof Error ? status.error.message : ""}` : worktreeCleanupNote(status.data));
  return (
    <div class="frow as-frow-switch ft-row">
      <div class="flabel">
        <span class="ft-name">
          <span class="info-line">
            <label for="ft-worktree-cleanup">Clean up finished worktrees</label>
            <InfoTip label="About cleaning up finished worktrees">{worktreeCleanupInfo(status.data)}</InfoTip>
          </span>
        </span>
        <Show when={note()}>{(text) => <span class="fhelp ft-note">{text()}</span>}</Show>
      </div>
      <select
        id="ft-worktree-cleanup"
        class="input ft-select"
        value={status.data?.mode ?? "off"}
        disabled={!props.editable || !status.data}
        onChange={(event) => props.onChange(event.currentTarget.value as WorktreeCleanupMode)}
      >
        <For each={options()}>
          {(option) => (
            <option value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          )}
        </For>
      </select>
    </div>
  );
}
