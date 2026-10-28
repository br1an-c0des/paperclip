import type { CurrentUserProfile } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { ArrowRight, LogOut } from "lucide-solid";
import { createEffect, createSignal, For, on, Show } from "solid-js";
import { accountApi } from "@/api/account";
import { queryKeys } from "@/api/queryKeys";
import { useCompaniesQuery, useCompany } from "@/lib/company";
import { useSession, useSignOut } from "@/lib/session";
import { InitialsDisc } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { SettingsCard, SettingsRow, TextInput } from "@/ui/Field";
import { pushToast } from "@/ui/Toast";
import { APP_SETTINGS_PATH, avatarNamespace, displayNameProblem } from "./app-settings-model";
import { failure, LaterNote, SaveNote, SectionTitle, useSaver } from "./shared";

/*
 * Account (board 30's outline): your profile, the organizations you belong to, and signing out.
 * The profile is `GET|PATCH /api/auth/profile`, which a local_trusted instance answers for the local
 * board user too. The name saves when the field loses focus; a new avatar is uploaded into this
 * organization's file storage and saved at once, as in the old UI.
 *
 * Not here yet: changing your password and seeing your sessions (the old UI has neither), and
 * leaving an organization (no request for it).
 */

export function AccountSection(props: { isAdmin: boolean }) {
  const client = useQueryClient();
  const company = useCompany();
  const session = useSession();
  const signOut = useSignOut();
  const companies = useCompaniesQuery();
  const profile = createQuery(() => ({ queryKey: queryKeys.instanceSettings.profile, queryFn: accountApi.profile }));
  const saver = useSaver();
  const [name, setName] = createSignal("");
  const [problem, setProblem] = createSignal<string | null>(null);
  let fileInput: HTMLInputElement | undefined;

  createEffect(on(() => profile.data?.name, (value) => setName(value ?? "")));

  const savedName = () => profile.data?.name ?? "";
  const shownName = () => savedName() || profile.data?.email || "You";

  const persist = (input: { name: string; image: string | null }) =>
    saver.run(async () => {
      const saved = await accountApi.updateProfile(input);
      client.setQueryData<CurrentUserProfile>(queryKeys.instanceSettings.profile, saved);
      // The nav and comments show your name from the session.
      await client.invalidateQueries({ queryKey: queryKeys.auth.session });
    }, "Couldn't save your profile.");

  const saveName = () => {
    const value = name().trim();
    if (value === savedName()) return setProblem(null);
    const issue = displayNameProblem(value);
    setProblem(issue);
    if (!issue) void persist({ name: value, image: profile.data?.image ?? null });
  };

  const upload = async (file: File) => {
    const userId = profile.data?.id ?? "board-user";
    try {
      const asset = await accountApi.uploadAvatar(company().id, file, avatarNamespace(userId));
      await persist({ name: savedName() || shownName(), image: asset.contentPath });
    } catch (caught) {
      pushToast({ tone: "error", title: "Couldn't upload the photo", body: failure(caught, "Try a smaller image.") });
    }
  };

  return (
    <>
      <SectionTitle title="Account">You, on this Paperclip instance.</SectionTitle>

      <SettingsCard title="Profile" description={<SaveNote saver={saver}>How you appear in the sidebar, in comments and to agents.</SaveNote>}>
        <SettingsRow label="Photo" help={`Stored in ${company().name}'s file storage.`}>
          <div class="as-inline">
            <Show when={profile.data?.image} fallback={<InitialsDisc name={shownName()} you size={48} />}>
              {(src) => <img class="as-avatar" src={src()} alt="" width="48" height="48" />}
            </Show>
            <input
              ref={fileInput}
              class="sr-only"
              type="file"
              accept="image/*"
              aria-label="Choose a photo"
              tabindex={-1}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void upload(file);
              }}
            />
            <Button disabled={!profile.data || saver.busy()} onClick={() => fileInput?.click()}>
              {profile.data?.image ? "Change photo" : "Upload photo"}
            </Button>
            <Show when={profile.data?.image}>
              <Button ghost disabled={saver.busy()} onClick={() => void persist({ name: savedName() || shownName(), image: null })}>
                Remove
              </Button>
            </Show>
          </div>
        </SettingsRow>
        <SettingsRow label="Display name" for="as-name" help="Changes save when you leave the field.">
          <div class="as-stack">
            <TextInput
              id="as-name"
              class="as-field-320"
              value={name()}
              maxLength={120}
              autocomplete="name"
              disabled={!profile.data}
              invalid={Boolean(problem())}
              onInput={(event) => setName(event.currentTarget.value)}
              onBlur={saveName}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") {
                  setName(savedName());
                  setProblem(null);
                  event.currentTarget.blur();
                }
              }}
            />
            <Show when={problem()}>
              <span class="field-error" role="alert">
                {problem()}
              </span>
            </Show>
          </div>
        </SettingsRow>
        <SettingsRow label="Email" help="Set by how you sign in.">
          <div class="as-muted as-min-34">{profile.data?.email ?? "None"}</div>
        </SettingsRow>
      </SettingsCard>

      <SettingsCard title="Your organizations" description="The organizations you belong to.">
        <For each={companies.data ?? []} fallback={<p class="as-empty-line">You don't belong to any organization yet.</p>}>
          {(entry) => (
            <div class="as-lrow">
              <span class="as-lrow-mark">
                <InitialsDisc name={entry.name.slice(0, 1)} seed={entry.id} size={28} />
              </span>
              <div class="as-lrow-main">
                <div class="as-lrow-title">
                  <span class="as-lrow-name">{entry.name}</span>
                  <span class="mono as-lrow-mono">{entry.issuePrefix}</span>
                </div>
              </div>
              <div class="as-lrow-end">
                <Show when={entry.id === company().id} fallback={<A class="as-link" href={`/${entry.issuePrefix}/dashboard`}>Open</A>}>
                  <span class="as-muted">Open now</span>
                </Show>
              </div>
            </div>
          )}
        </For>
        <Show when={props.isAdmin}>
          <footer class="cfoot">
            <A class="as-link" href={`/${company().issuePrefix}${APP_SETTINGS_PATH}/organizations`}>
              Every organization on this instance
              <ArrowRight size={13} aria-hidden="true" />
            </A>
          </footer>
        </Show>
      </SettingsCard>

      <Show when={!(session.health()?.hiddenSettings ?? []).includes("instance.general.signOut")}>
        <SettingsCard title="Sign-in">
          <Show
            when={session.isAuthenticatedMode()}
            fallback={
              <div class="frow">
                <div class="flabel">No sign-in</div>
                <div class="as-muted as-min-34">This instance runs in local trusted mode: the browser acts as the local board, with no sign-in.</div>
              </div>
            }
          >
            <SettingsRow label="Sign out" help="Ends this browser's session. You'll go to the sign-in page.">
              <Button icon={<LogOut size={15} />} onClick={() => void signOut()}>
                Sign out
              </Button>
            </SettingsRow>
          </Show>
        </SettingsCard>
        <LaterNote title="Not here yet">Changing your password, seeing your active sessions, and leaving an organization.</LaterNote>
      </Show>
    </>
  );
}
