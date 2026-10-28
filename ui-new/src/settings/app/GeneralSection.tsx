import type { BackupRetentionPolicy, FeedbackDataSharingPreference, InstanceGeneralSettings, PatchInstanceGeneralSettings } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { CircleAlert, CircleCheck } from "lucide-solid";
import { For, Show } from "solid-js";
import { instanceSettingsApi } from "@/api/instance-settings";
import { queryKeys } from "@/api/queryKeys";
import { useSession } from "@/lib/session";
import { SettingsCard, SettingsRow } from "@/ui/Field";
import { Segmented } from "@/ui/Segmented";
import {
  backupStatus,
  deploymentMode,
  executionPolicy,
  FEEDBACK_OPTIONS,
  RETENTION,
  retentionLabel,
  signInChecks,
  type InstanceHealth,
} from "./app-settings-model";
import { SaveNote, SectionTitle, StatePill, SwitchRow, useSaver } from "./shared";

/*
 * General (board 28): how this instance is deployed, its privacy defaults and its backups.
 * Deployment and sign-in come from `GET /api/health` and are set in the server's configuration, so
 * they're read-only. Privacy and backups save as you change them
 * (`PATCH /api/instance/settings/general`). An operator can hide each card with
 * `PAPERCLIP_HIDDEN_SETTINGS`, as in the old UI.
 */

const DEFAULT_RETENTION: BackupRetentionPolicy = { dailyDays: 7, weeklyWeeks: 4, monthlyMonths: 1 };

export function GeneralSection() {
  const session = useSession();
  const client = useQueryClient();
  const health = () => session.health() as InstanceHealth | undefined;
  const hidden = () => new Set(health()?.hiddenSettings ?? []);
  const general = createQuery(() => ({ queryKey: queryKeys.instance.generalSettings, queryFn: instanceSettingsApi.general }));
  const privacy = useSaver();
  const backups = useSaver();

  const save = (saver: ReturnType<typeof useSaver>, patch: PatchInstanceGeneralSettings) =>
    saver.run(async () => {
      const saved = await instanceSettingsApi.updateGeneral(patch);
      client.setQueryData<InstanceGeneralSettings>(queryKeys.instance.generalSettings, saved);
    });

  const retention = () => general.data?.backupRetention ?? DEFAULT_RETENTION;
  const mode = () => deploymentMode(health());
  const checks = () => signInChecks(health());
  const authenticated = () => health()?.deploymentMode === "authenticated";
  const backup = () => backupStatus(health()?.databaseBackup);

  return (
    <>
      <SectionTitle title="General">How this instance is deployed, its privacy defaults, and its backups. They apply to every organization on this server.</SectionTitle>

      <Show when={!hidden().has("instance.general.deploymentStatus")}>
        <SettingsCard title="Deployment and sign-in" description="Set in the server's configuration when it starts. Shown here so you can check it.">
          <SettingsRow label="Mode">
            <div class="as-inline as-min-34">
              <StatePill label={mode().label} tone="green" />
              <span class="as-muted">{mode().note}</span>
            </div>
          </SettingsRow>
          <Show when={checks().length}>
            <SettingsRow label="Sign-in checks">
              <ul class="as-checks">
                <For each={checks()}>
                  {(check) => (
                    <li classList={{ "as-check--bad": !check.ok }}>
                      <Show when={check.ok} fallback={<CircleAlert size={15} aria-hidden="true" />}>
                        <CircleCheck size={15} aria-hidden="true" />
                      </Show>
                      {check.text}
                    </li>
                  )}
                </For>
              </ul>
            </SettingsRow>
          </Show>
          <Show when={authenticated()}>
            <SettingsRow label="First-admin invite">
              <div class="as-muted as-min-34">{health()?.bootstrapInviteActive ? "An invite is open and not used yet." : "None open."}</div>
            </SettingsRow>
          </Show>
          <SettingsRow label="Where agents may run">
            <div class="as-inline as-min-34">
              <span>{executionPolicy(general.data?.executionMode)}</span>
              <span class="as-chip">set by the server</span>
            </div>
          </SettingsRow>
          <Show when={health()?.version}>
            <SettingsRow label="Version">
              <div class="mono as-min-34 as-muted">{health()!.version}</div>
            </SettingsRow>
          </Show>
        </SettingsCard>
      </Show>

      <Show when={!hidden().has("instance.general.censorUsernameInLogs") || !hidden().has("instance.general.feedbackDataSharingPreference")}>
        <SettingsCard title="Privacy" description={<SaveNote saver={privacy}>Changes save as you make them.</SaveNote>}>
          <Show when={!hidden().has("instance.general.censorUsernameInLogs")}>
            <SwitchRow
              label="Hide usernames in logs"
              help="Replaces your computer's username in home-folder paths in run logs and transcripts. Other mentions of it aren't hidden yet."
              checked={general.data?.censorUsernameInLogs === true}
              disabled={!general.data || privacy.busy()}
              onChange={(value) => void save(privacy, { censorUsernameInLogs: value })}
            />
          </Show>
          <Show when={!hidden().has("instance.general.feedbackDataSharingPreference")}>
            <SettingsRow
              label="AI feedback sharing"
              help="Whether a thumbs up or down on an agent's output also sends that output to Paperclip Labs. Votes are always kept here."
            >
              <div class="as-stack">
                <Segmented<FeedbackDataSharingPreference>
                  label="AI feedback sharing"
                  options={FEEDBACK_OPTIONS}
                  value={general.data?.feedbackDataSharingPreference ?? "prompt"}
                  onChange={(value) => {
                    if (general.data && !privacy.busy() && value !== general.data.feedbackDataSharingPreference) {
                      void save(privacy, { feedbackDataSharingPreference: value });
                    }
                  }}
                />
                <Show when={(general.data?.feedbackDataSharingPreference ?? "prompt") === "prompt"}>
                  <span class="fhelp">The next vote asks once, then saves the answer here.</span>
                </Show>
              </div>
            </SettingsRow>
          </Show>
        </SettingsCard>
      </Show>

      <Show when={!hidden().has("instance.general.backupRetention")}>
        <SettingsCard
          title="Backups"
          description={
            <SaveNote saver={backups}>
              How long Paperclip keeps its automatic database backups.
              <Show when={backup()}>{(status) => <span classList={{ "as-bad": !status().ok }}> {status().text}</span>}</Show>
            </SaveNote>
          }
        >
          <For each={Object.entries(RETENTION) as [keyof BackupRetentionPolicy, (typeof RETENTION)[keyof BackupRetentionPolicy]][]}>
            {([key, meta]) => (
              <SettingsRow label={meta.label} help={meta.help}>
                <Segmented
                  label={meta.label}
                  options={meta.values.map((count) => ({ value: String(count), label: retentionLabel(count, meta.unit) }))}
                  value={String(retention()[key])}
                  onChange={(value) => {
                    const count = Number(value);
                    if (!general.data || backups.busy() || count === retention()[key]) return;
                    void save(backups, { backupRetention: { ...retention(), [key]: count } as BackupRetentionPolicy });
                  }}
                />
              </SettingsRow>
            )}
          </For>
        </SettingsCard>
      </Show>
    </>
  );
}
