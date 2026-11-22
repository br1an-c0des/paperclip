import type { InstanceExperimentalSettingsWithManaged, WorktreeCleanupMode, WorktreeCleanupValues } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { Check, Lock } from "lucide-solid";
import { createMemo, For, Show } from "solid-js";
import { accessApi } from "@/api/access";
import { instanceSettingsApi } from "@/api/instance-settings";
import { queryKeys } from "@/api/queryKeys";
import { useExperimentalSettingsQuery } from "@/lib/company-data";
import { SettingsCard, TextInput } from "@/ui/Field";
import { InfoTip } from "@/ui/InfoTip";
import { Switch } from "@/ui/Switch";
import {
  featurePatch,
  featureRowState,
  linkedNote,
  parseCleanupDays,
  visibleFeatureGroups,
  WORKTREE_CLEANUP_DEFAULT_VALUES,
  WORKTREE_CLEANUP_VALUE_INFO,
  worktreeCleanupInfo,
  worktreeCleanupNote,
  worktreeCleanupOptions,
  worktreeCleanupPatch,
  worktreeCleanupValuesShown,
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

type WorktreeCleanupChange = { mode?: WorktreeCleanupMode } & Partial<WorktreeCleanupValues>;

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

  // The worktree cleanup level and values save like a switch, then reread what's in force.
  const changeCleanup = (change: WorktreeCleanupChange) => {
    void saver.run(async () => {
      const saved = await instanceSettingsApi.updateExperimental(worktreeCleanupPatch(change));
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
                  <WorktreeCleanupRow editable={context().editable} onChange={changeCleanup} />
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
 * Clean up finished worktrees (step 4b part 3): one level for everything the server's reaper does to
 * finished tasks' worktrees, and below it (unless Off) the wait, compaction and, at the restore point
 * level, its days. What each does and the defaults sit behind the "i"s; the line under the level
 * says only state: why restore points can't be chosen. Each
 * option marks itself selected, since the select's own value is set before <For> adds the options.
 */
function WorktreeCleanupRow(props: { editable: boolean; onChange: (change: WorktreeCleanupChange) => void }) {
  const status = createQuery(() => ({
    queryKey: queryKeys.instance.worktreeCleanup,
    queryFn: () => instanceSettingsApi.worktreeCleanup(),
  }));
  const options = createMemo(() => worktreeCleanupOptions(status.data));
  const shown = () => worktreeCleanupValuesShown(status.data?.mode);
  const values = () => status.data?.values ?? WORKTREE_CLEANUP_DEFAULT_VALUES;
  const disabled = () => !props.editable || !status.data;
  const change = (next: WorktreeCleanupChange) => props.onChange(next);
  const note = () => (status.isError ? `Couldn't read the cleanup setting. ${status.error instanceof Error ? status.error.message : ""}` : worktreeCleanupNote(status.data));
  return (
    <>
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
          disabled={disabled()}
          onChange={(event) => change({ mode: event.currentTarget.value as WorktreeCleanupMode })}
        >
          <For each={options()}>
            {(option) => (
              <option value={option.value} disabled={option.disabled} selected={option.value === (status.data?.mode ?? "off")}>
                {option.label}
              </option>
            )}
          </For>
        </select>
      </div>
      <Show when={shown().general}>
        <CleanupDaysRow
          id="ft-cleanup-wait"
          label="Wait after a task closes"
          info={WORKTREE_CLEANUP_VALUE_INFO.waitDays}
          value={values().waitDays}
          disabled={disabled()}
          onChange={(waitDays) => change({ waitDays })}
        />
        <div class="frow as-frow-switch ft-row ft-subrow">
          <div class="flabel">
            <span class="info-line">
              Remove dependencies and build output from finished worktrees
              <InfoTip label="About removing dependencies and build output">{WORKTREE_CLEANUP_VALUE_INFO.removeBuildOutput}</InfoTip>
            </span>
          </div>
          <Switch
            checked={values().removeBuildOutput}
            disabled={disabled()}
            onChange={(removeBuildOutput) => change({ removeBuildOutput })}
            label="Remove dependencies and build output from finished worktrees"
            labelHidden
          />
        </div>
      </Show>
      <Show when={shown().restorePoints}>
        <CleanupDaysRow
          id="ft-cleanup-restore-after"
          label="Save a restore point after"
          info={WORKTREE_CLEANUP_VALUE_INFO.restorePointAfterDays}
          value={values().restorePointAfterDays}
          disabled={disabled()}
          onChange={(restorePointAfterDays) => change({ restorePointAfterDays })}
        />
        <CleanupDaysRow
          id="ft-cleanup-restore-idle"
          label="Remove idle worktrees after"
          info={WORKTREE_CLEANUP_VALUE_INFO.restorePointIdleDays}
          value={values().restorePointIdleDays}
          disabled={disabled()}
          onChange={(restorePointIdleDays) => change({ restorePointIdleDays })}
        />
      </Show>
    </>
  );
}

/** A day count under the cleanup level: saves on change (Enter or leaving the field); a bad value goes back. */
function CleanupDaysRow(props: { id: string; label: string; info: string; value: number; disabled: boolean; onChange: (days: number) => void }) {
  return (
    <div class="frow as-frow-switch ft-row ft-subrow">
      <div class="flabel">
        <span class="info-line">
          <label for={props.id}>{props.label}</label>
          <InfoTip label={`About ${props.label.toLowerCase()}`}>{props.info}</InfoTip>
        </span>
      </div>
      <span class="ft-days">
        <TextInput
          id={props.id}
          class="ft-days-input"
          type="number"
          inputmode="numeric"
          min={0}
          max={365}
          step={1}
          value={String(props.value)}
          disabled={props.disabled}
          onChange={(event) => {
            const days = parseCleanupDays(event.currentTarget.value);
            if (days === null || days === props.value) event.currentTarget.value = String(props.value);
            else props.onChange(days);
          }}
        />
        <span class="ft-days-unit" aria-hidden="true">
          days
        </span>
      </span>
    </div>
  );
}
