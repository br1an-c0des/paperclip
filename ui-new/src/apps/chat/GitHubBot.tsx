import type { GitHubChatConfiguration, GitHubReviewEvent, GitHubReviewPolicy } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { createInfiniteQuery, createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { ExternalLink, Plus, RefreshCw } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch, type JSX } from "solid-js";
import { accessApi } from "@/api/access";
import { chatEndpointsApi, githubChatApi, type ChatEndpoint, type GitHubConfigurationRecord } from "@/api/chat-endpoints";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { Button, buttonClass } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Field, TextArea, TextInput } from "@/ui/Field";
import { Switch as Toggle } from "@/ui/Switch";
import { pushToast } from "@/ui/Toast";
import { failureText } from "../shared";
import {
  appSettingsUrl,
  botMention,
  INVOCATION_LABELS,
  lines,
  mentionsAllowed,
  parseScore,
  peopleRows,
  repositoryNote,
  REVIEW_EVENTS,
  toggleEvent,
  withoutPerson,
  withPerson,
  type PersonRow,
} from "./github-model";
import { Card } from "./parts";
import { TaskDefaults } from "./TaskDefaults";
import "./ChatExtras.css";

/*
 * A GitHub review bot's own settings (the old UI's GitHubBotManagement and GitHubBotConfiguration):
 *
 * - Settings tab: the App (its @mention, its settings on GitHub, reconnect after a rename), the
 *   repositories it may work in (searched and paged, on or off one at a time or all at once,
 *   refreshed from GitHub, each with its own task defaults), and how it reviews: instructions, when
 *   it runs, its automatic filters, what it posts and its passing score.
 * - Access tab: who may mention it or start work automatically: linked company members (all or
 *   picked), outside contributors a member sponsors, the member responsible for automatic tasks,
 *   and turning the bot's GitHub tools on.
 *
 * The review configuration is one document saved whole with the revision it was read at
 * (`PUT …/github/configuration`); repository switches save at once.
 */

function useConfiguration(endpoint: () => ChatEndpoint) {
  const company = useCompany();
  const client = useQueryClient();
  const key = () => queryKeys.chatEndpoints.part(company().id, endpoint().id, "github-configuration");
  const query = createQuery(() => ({
    queryKey: key(),
    queryFn: ({ signal }) => githubChatApi.configuration(endpoint().id, signal),
    retry: false,
  }));
  const [draft, setDraft] = createSignal<GitHubChatConfiguration | null>(null);
  const current = () => draft() ?? query.data?.configuration ?? null;
  const dirty = () => Boolean(draft() && JSON.stringify(draft()) !== JSON.stringify(query.data?.configuration));
  const save = createMutation(() => ({
    mutationFn: () => githubChatApi.saveConfiguration(endpoint().id, query.data!.revision, draft()!),
    onSuccess: (saved: GitHubConfigurationRecord) => {
      client.setQueryData(key(), saved);
      setDraft(null);
      pushToast({ tone: "success", title: "GitHub settings saved" });
    },
    onError: (error) => pushToast({ tone: "error", title: "Couldn't save the GitHub settings", body: failureText(error, "Someone may have changed them; reload and try again.") }),
  }));
  return { query, current, dirty, edit: (next: GitHubChatConfiguration) => setDraft(next), discard: () => setDraft(null), save };
}

type ConfigurationState = ReturnType<typeof useConfiguration>;

function SaveBar(props: { state: ConfigurationState; invalid?: string | null; onDiscard?: () => void }) {
  return (
    <Show when={props.state.dirty() || props.invalid}>
      <div class="card ch-savebar" role="region" aria-label="Unsaved GitHub settings">
        <Show when={props.invalid} fallback={<span>Unsaved changes.</span>}>
          <span class="cx-note cx-note--error">{props.invalid}</span>
        </Show>
        <span class="ap-actions-end">
          <Button
            variant="quiet"
            disabled={props.state.save.isPending}
            onClick={() => {
              props.state.discard();
              props.onDiscard?.();
            }}
          >
            Discard
          </Button>
          <Button variant="primary" disabled={props.state.save.isPending || Boolean(props.invalid) || !props.state.dirty()} onClick={() => props.state.save.mutate()}>
            {props.state.save.isPending ? "Saving…" : "Save changes"}
          </Button>
        </span>
      </div>
    </Show>
  );
}

function ConfigurationGate(props: { state: ConfigurationState; children: (configuration: GitHubChatConfiguration) => JSX.Element }) {
  return (
    <Switch>
      <Match when={props.state.query.isPending}>
        <p class="ap-empty card" role="status">
          Loading the bot's configuration…
        </p>
      </Match>
      <Match when={props.state.query.isError}>
        <div class="ap-empty card" role="alert">
          <p>Couldn't load the bot's configuration.</p>
          <Button size="compact" onClick={() => void props.state.query.refetch()}>
            Try again
          </Button>
        </div>
      </Match>
      <Match when={props.state.current()}>{(configuration) => props.children(configuration())}</Match>
    </Switch>
  );
}

// ---------------------------------------------------------------------------------------------
// Settings tab

export function GitHubSettings(props: { endpoint: ChatEndpoint; base: string }) {
  const state = useConfiguration(() => props.endpoint);
  const [scoreText, setScoreText] = createSignal<string | null>(null);
  const invalid = () => {
    const configuration = state.current();
    if (!configuration || scoreText() === null) return null;
    return parseScore(scoreText()!, configuration.defaults.ratingThreshold === null).ok ? null : "The passing score is a whole number from 1 to 5.";
  };
  return (
    <>
      <GitHubApp endpoint={props.endpoint} base={props.base} />
      <GitHubRepositories endpoint={props.endpoint} />
      <ConfigurationGate state={state}>
        {(configuration) => (
          <ReviewPolicy
            policy={configuration.defaults}
            accessHref={`${props.base}/chat/${props.endpoint.id}/access`}
            scoreText={scoreText() ?? String(configuration.defaults.ratingThreshold ?? 5)}
            onScoreText={(text) => {
              setScoreText(text);
              const parsed = parseScore(text, false);
              if (parsed.ok) state.edit({ ...configuration, defaults: { ...configuration.defaults, ratingThreshold: parsed.value } });
            }}
            onChange={(defaults) => state.edit({ ...configuration, defaults })}
          />
        )}
      </ConfigurationGate>
      <SaveBar state={state} invalid={invalid()} onDiscard={() => setScoreText(null)} />
    </>
  );
}

function GitHubApp(props: { endpoint: ChatEndpoint; base: string }) {
  return (
    <Card title="The GitHub App" description="People mention the bot by the App's name. Rename it or change its logo on GitHub, then reconnect so Paperclip picks up the new name.">
      <p class="ch-inline">
        <Show when={botMention(props.endpoint)} fallback={<span class="cx-static">No @mention yet; finish setup first.</span>}>
          {(mention) => <code class="mono">{mention()}</code>}
        </Show>
        <a class={buttonClass({ size: "compact", variant: "quiet" })} href={appSettingsUrl(props.endpoint)} target="_blank" rel="noopener noreferrer">
          Edit the App on GitHub <ExternalLink size={13} aria-hidden="true" />
        </a>
        <A class={buttonClass({ size: "compact", variant: "quiet" })} href={`${props.base}/chat/connect?provider=github&resume=${encodeURIComponent(props.endpoint.id)}&reconnect=1`}>
          <RefreshCw size={13} aria-hidden="true" /> Reconnect after a rename
        </A>
      </p>
    </Card>
  );
}

/** The repositories the App is installed on, each on or off for the bot, with its own task defaults. */
function GitHubRepositories(props: { endpoint: ChatEndpoint }) {
  const company = useCompany();
  const client = useQueryClient();
  const [search, setSearch] = createSignal("");
  const [open, setOpen] = createSignal<string | null>(null);
  const prefix = () => queryKeys.chatEndpoints.part(company().id, props.endpoint.id, "github-repositories");
  const list = createInfiniteQuery(() => ({
    queryKey: [...prefix(), search()],
    queryFn: ({ pageParam, signal }) => githubChatApi.repositories(props.endpoint.id, { limit: 20, offset: pageParam, search: search() }, signal),
    initialPageParam: 0,
    getNextPageParam: (page) => page.nextOffset ?? undefined,
  }));
  const rows = () => list.data?.pages.flatMap((page) => page.items) ?? [];
  const summary = () => list.data?.pages[0];
  const anyOn = () => (summary()?.enabledCount ?? 0) > 0;
  const refresh = () => client.invalidateQueries({ queryKey: prefix() });
  const act = createMutation(() => ({
    mutationFn: async (action: { kind: "one"; id: string; enabled: boolean } | { kind: "all"; enabled: boolean } | { kind: "refresh" }) => {
      if (action.kind === "one") await chatEndpointsApi.updateResources(props.endpoint.id, [{ id: action.id, enabled: action.enabled }]);
      else if (action.kind === "all") await githubChatApi.toggleAllRepositories(props.endpoint.id, action.enabled);
      else {
        await githubChatApi.refreshRepositories(props.endpoint.id);
        pushToast({ tone: "success", title: "Repositories refreshed", body: "New repositories start off." });
      }
    },
    onSettled: () => refresh(),
    onError: (error) => pushToast({ tone: "error", title: "Couldn't change the repositories", body: failureText(error, "Try again.") }),
  }));
  const manageUrl = () => props.endpoint.setup?.github?.managementUrl ?? props.endpoint.setup?.github?.installationUrl ?? "https://github.com/settings/installations";

  return (
    <Card title="Repositories" description="Where the bot takes messages and uses its tools. Changes save at once.">
      <div class="ch-inline">
        <TextInput type="search" aria-label="Search repositories" placeholder="Search repositories" maxLength={200} value={search()} onInput={(event) => setSearch(event.currentTarget.value)} />
        <Button
          size="compact"
          disabled={act.isPending || list.isFetching || !summary()?.totalCount || (!anyOn() && !summary()?.availableCount)}
          onClick={() => act.mutate({ kind: "all", enabled: !anyOn() })}
        >
          {anyOn() ? "Turn all off" : "Turn all on"}
        </Button>
        <Button size="compact" variant="quiet" icon={<RefreshCw size={13} aria-hidden="true" />} disabled={act.isPending} onClick={() => act.mutate({ kind: "refresh" })}>
          Refresh from GitHub
        </Button>
        <a class={buttonClass({ size: "compact", variant: "quiet" })} href={manageUrl()} target="_blank" rel="noopener noreferrer">
          Manage on GitHub <ExternalLink size={13} aria-hidden="true" />
        </a>
      </div>
      <Show when={summary()}>
        {(page) => (
          <p class="cx-static">
            {page().enabledCount} of {page().totalCount} repositories on. Turning all on or off applies to every repository, not only those shown.
          </p>
        )}
      </Show>
      <Switch>
        <Match when={list.isPending}>
          <p class="cx-static" role="status">
            Loading repositories…
          </p>
        </Match>
        <Match when={list.isError}>
          <p class="cx-note cx-note--error" role="alert">
            Couldn't load the repositories.{" "}
            <button type="button" class="cx-link" onClick={() => void list.refetch()}>
              Try again
            </button>
          </p>
        </Match>
        <Match when={rows().length === 0}>
          <p class="cx-static">{search() ? "No repositories match." : "No repositories yet. Give the App access to some on GitHub, then refresh."}</p>
        </Match>
        <Match when={true}>
          <ul class="ch-list ch-repos" aria-label="Repositories">
            <For each={rows()}>
              {(resource) => (
                <li>
                  <Toggle
                    checked={resource.enabled}
                    disabled={act.isPending || (resource.availability !== "available" && !resource.enabled)}
                    onChange={(enabled) => act.mutate({ kind: "one", id: resource.id, enabled })}
                    label={resource.label ?? resource.providerResourceId}
                    description={repositoryNote(resource)}
                  />
                  <button type="button" class="cx-link ch-defaults-toggle" aria-expanded={open() === resource.id} onClick={() => setOpen(open() === resource.id ? null : resource.id)}>
                    Task defaults
                  </button>
                  <Show when={open() === resource.id}>
                    <TaskDefaults
                      value={resource.executionDefaults}
                      resource
                      onSave={async (executionDefaults) => {
                        await chatEndpointsApi.updateResources(props.endpoint.id, [{ id: resource.id, executionDefaults }]);
                        await refresh();
                      }}
                    />
                  </Show>
                </li>
              )}
            </For>
          </ul>
          <Show when={list.hasNextPage}>
            <Button size="compact" variant="quiet" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
              {list.isFetchingNextPage ? "Loading…" : "Load more repositories"}
            </Button>
          </Show>
        </Match>
      </Switch>
    </Card>
  );
}

function ListField(props: { id: string; label: string; help: string; values: string[]; onChange: (values: string[]) => void }) {
  const [text, setText] = createSignal(props.values.join("\n"));
  createEffect(on(() => props.values.join("\n"), (value) => (lines(text()).join("\n") === value ? undefined : setText(value)), { defer: true }));
  return (
    <Field label={props.label} for={props.id} help={props.help}>
      <TextArea
        id={props.id}
        rows={3}
        class="mono"
        value={text()}
        onInput={(event) => {
          setText(event.currentTarget.value);
          props.onChange(lines(event.currentTarget.value));
        }}
      />
    </Field>
  );
}

function ReviewPolicy(props: {
  policy: GitHubReviewPolicy;
  accessHref: string;
  scoreText: string;
  onScoreText: (text: string) => void;
  onChange: (policy: GitHubReviewPolicy) => void;
}) {
  const set = <K extends keyof GitHubReviewPolicy>(key: K, value: GitHubReviewPolicy[K]) => props.onChange({ ...props.policy, [key]: value });
  const [lastAutomatic, setLastAutomatic] = createSignal<"linked_authors" | "allowed_authors">("linked_authors");
  createEffect(() => {
    if (props.policy.invocation !== "mentions_only") setLastAutomatic(props.policy.invocation);
  });
  const [promptEvent, setPromptEvent] = createSignal<GitHubReviewEvent | "issue_opened">("opened");
  const automatic = () => props.policy.invocation !== "mentions_only";

  return (
    <>
      <Card title="Instructions" description="Included in every GitHub task.">
        <Field label="What should the agent do on GitHub?" for="gh-instructions">
          <TextArea id="gh-instructions" rows={5} value={props.policy.instructions} onInput={(event) => set("instructions", event.currentTarget.value)} />
        </Field>
        <details class="ch-details">
          <summary>Instructions for one event</summary>
          <div class="ch-step-body">
            <select class="input" aria-label="Event" value={promptEvent()} onChange={(event) => setPromptEvent(event.currentTarget.value as GitHubReviewEvent | "issue_opened")}>
              <For each={REVIEW_EVENTS}>{(event) => <option value={event.key}>{event.label}</option>}</For>
              <option value="issue_opened">New issue</option>
            </select>
            <TextArea
              rows={4}
              aria-label="Instructions for this event"
              value={promptEvent() === "issue_opened" ? (props.policy.issueOpenedInstructions ?? "") : props.policy.prompts[promptEvent() as GitHubReviewEvent]}
              onInput={(event) => {
                const value = event.currentTarget.value;
                const key = promptEvent();
                if (key === "issue_opened") set("issueOpenedInstructions", value);
                else set("prompts", { ...props.policy.prompts, [key]: value });
              }}
            />
            <p class="cx-static">Added to the main instructions for this event.</p>
          </div>
        </details>
      </Card>

      <Card title="When it runs" description={INVOCATION_LABELS[props.policy.invocation]}>
        <p class="cx-static">
          People allowed in <A href={props.accessHref}>Access</A> can always @mention the bot.
        </p>
        <Toggle
          checked={automatic()}
          onChange={(on) => set("invocation", on ? lastAutomatic() : "mentions_only")}
          label="Run automatically"
          description="Start work without a mention when an allowed person opens an issue or updates a pull request."
        />
        <Show when={automatic()}>
          <fieldset class="ch-checks-grid" aria-label="Automatic events">
            <For each={REVIEW_EVENTS.slice(0, 4)}>
              {(event) => (
                <label class="ch-check">
                  <input type="checkbox" checked={props.policy.events.includes(event.key)} onChange={(e) => props.onChange(toggleEvent(props.policy, event.key, e.currentTarget.checked))} />
                  {event.label}
                </label>
              )}
            </For>
            <label class="ch-check">
              <input type="checkbox" checked={props.policy.issueOpened === true} onChange={(e) => set("issueOpened", e.currentTarget.checked)} />
              New issues
            </label>
          </fieldset>
          <details class="ch-details">
            <summary>Automatic review filters</summary>
            <div class="ch-step-body">
              <Toggle checked={props.policy.reviewDrafts} onChange={(value) => set("reviewDrafts", value)} label="Include draft pull requests" />
              <Toggle
                checked={props.policy.reviewBotAuthors}
                onChange={(value) => set("reviewBotAuthors", value)}
                label="Include bot authors"
                description="The bot account also needs a sponsor and automatic runs for outside contributors in Access."
              />
              <div class="ch-grid">
                <ListField id="gh-include-authors" label="Included authors" help="Empty means every allowed author. One username or glob per line." values={props.policy.includeAuthors} onChange={(values) => set("includeAuthors", values)} />
                <ListField id="gh-exclude-authors" label="Excluded authors" help="One username or glob per line." values={props.policy.excludeAuthors} onChange={(values) => set("excludeAuthors", values)} />
                <ListField id="gh-target-branches" label="Target branches" help="Empty means every branch. Supports * and **." values={props.policy.targetBranches} onChange={(values) => set("targetBranches", values)} />
                <ListField id="gh-excluded-branches" label="Excluded branches" help="Supports * and **." values={props.policy.excludedBranches} onChange={(values) => set("excludedBranches", values)} />
                <ListField id="gh-required-labels" label="Required labels" help="Every listed label must be there." values={props.policy.requiredLabels} onChange={(values) => set("requiredLabels", values)} />
                <ListField id="gh-excluded-labels" label="Excluded labels" help="Any listed label stops an automatic review." values={props.policy.excludedLabels} onChange={(values) => set("excludedLabels", values)} />
              </div>
              <p class="cx-static">Reviews asked for by @mention skip these filters. Repository access and ignored files still apply.</p>
            </div>
          </details>
        </Show>
      </Card>

      <Card title="Review results">
        <Toggle checked={props.policy.publishSummary} onChange={(value) => set("publishSummary", value)} label="Post a review summary" />
        <Toggle checked={props.policy.publishInline} onChange={(value) => set("publishInline", value)} label="Post inline findings" />
        <div class="ch-grid">
          <Field label="Passing score" for="gh-score" help="A review scoring below this fails its check (1 to 5).">
            <TextInput
              id="gh-score"
              type="number"
              min={1}
              max={5}
              step={1}
              disabled={props.policy.ratingThreshold === null}
              value={props.scoreText}
              onInput={(event) => props.onScoreText(event.currentTarget.value)}
            />
          </Field>
          <label class="ch-check ch-check--end">
            <input type="checkbox" checked={props.policy.ratingThreshold === null} onChange={(event) => set("ratingThreshold", event.currentTarget.checked ? null : 5)} />
            Report only (no pass or fail)
          </label>
        </div>
        <details class="ch-details">
          <summary>Ignored files, inline comments, approvals</summary>
          <div class="ch-step-body">
            <ListField id="gh-ignored" label="Ignored file patterns" help="Left out of every review, @mentions included. One pattern per line; supports * and **." values={props.policy.ignoredPaths} onChange={(values) => set("ignoredPaths", values)} />
            <div class="ch-grid">
              <Field label="Finding categories" for="gh-categories" help="Separated by commas.">
                <TextInput
                  id="gh-categories"
                  value={props.policy.findingCategories.join(", ")}
                  onChange={(event) =>
                    set(
                      "findingCategories",
                      event.currentTarget.value
                        .split(",")
                        .map((entry) => entry.trim())
                        .filter(Boolean),
                    )
                  }
                />
              </Field>
              <Field label="Lowest severity posted inline" for="gh-severity" help="Hidden findings still count in the assessment.">
                <select id="gh-severity" class="input" value={props.policy.minimumCommentSeverity} onChange={(event) => set("minimumCommentSeverity", event.currentTarget.value as GitHubReviewPolicy["minimumCommentSeverity"])}>
                  <option value="info">Info</option>
                  <option value="warning">Warning</option>
                  <option value="error">Error</option>
                </select>
              </Field>
            </div>
            <Toggle
              checked={props.policy.allowApprove}
              onChange={(value) => set("allowApprove", value)}
              label="Allow approvals"
              description="The agent may submit an Approve review after a complete assessment. A 5/5 score alone doesn't approve."
            />
            <Toggle
              checked={props.policy.allowRequestChanges}
              onChange={(value) => set("allowRequestChanges", value)}
              label="Allow change requests"
              description="The agent may submit a Request changes review, which can block merging under your repository rules."
            />
          </div>
        </details>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Access tab

export function GitHubAccess(props: { endpoint: ChatEndpoint; base: string }) {
  const company = useCompany();
  const client = useQueryClient();
  const state = useConfiguration(() => props.endpoint);
  const members = createQuery(() => ({
    queryKey: queryKeys.chatEndpoints.part(company().id, props.endpoint.id, "github-members"),
    queryFn: ({ signal }) => accessApi.members(company().id, signal),
    retry: false,
  }));
  const linksKey = () => queryKeys.chatEndpoints.part(company().id, props.endpoint.id, "principals");
  const links = createQuery(() => ({
    queryKey: linksKey(),
    queryFn: ({ signal }) => chatEndpointsApi.principals(props.endpoint.id, signal),
  }));
  const active = createMemo(() => (members.data?.members ?? []).filter((member) => member.status === "active" && member.membershipRole !== "viewer"));
  const memberName = (userId: string) => {
    const member = active().find((entry) => entry.principalId === userId);
    return member?.user?.name ?? member?.user?.email ?? userId;
  };
  const unlink = createMutation(() => ({
    mutationFn: (principalId: string) => chatEndpointsApi.revokeLink(props.endpoint.id, principalId),
    onSettled: () => client.invalidateQueries({ queryKey: linksKey() }),
    onError: (error) => pushToast({ tone: "error", title: "Couldn't unlink that account", body: failureText(error, "Try again.") }),
  }));
  const [dialog, setDialog] = createSignal<"member" | "guest" | null>(null);
  const linkHref = () => `${props.base}/chat/connect?provider=github&resume=${encodeURIComponent(props.endpoint.id)}&stage=identity`;

  return (
    <>
      <ConfigurationGate state={state}>
        {(configuration) => {
          const rows = () => peopleRows(configuration, links.data ?? []);
          const automatic = () => configuration.defaults.invocation !== "mentions_only";
          const row = (person: PersonRow) => (
            <li class="ch-person">
              <div class="ch-person-main">
                <b>@{person.login}</b>
                <span class="cx-row-meta">{person.kind === "guest" ? `Sponsored by ${memberName(person.sponsorUserId)}` : (person.label ?? "Company member")}</span>
                <Show when={!person.linked}>
                  <span class="cx-note cx-note--error">Their GitHub account needs linking.</span>
                </Show>
              </div>
              <Show
                when={person.kind === "member" && configuration.memberAccess === "selected"}
                fallback={<span class="cx-row-meta">{person.linked ? "Mentions allowed" : "Unlinked"}</span>}
              >
                <Toggle
                  checked={mentionsAllowed(configuration, person)}
                  disabled={!person.linked}
                  label={`Allow mentions from @${person.login}`}
                  labelHidden
                  onChange={(on) =>
                    state.edit(on ? withPerson(configuration, { kind: "member", userId: (person as { userId: string }).userId, githubUserId: person.githubUserId, login: person.login }) : withoutPerson(configuration, person.githubUserId))
                  }
                />
              </Show>
              <Show when={person.explicit && (person.kind === "guest" || configuration.memberAccess === "selected")}>
                <Button size="compact" variant="quiet" onClick={() => state.edit(withoutPerson(configuration, person.githubUserId))}>
                  Remove
                </Button>
              </Show>
              <Show when={person.principalId}>
                {(principalId) => (
                  <Button size="compact" variant="quiet" disabled={unlink.isPending} onClick={() => unlink.mutate(principalId())}>
                    Unlink
                  </Button>
                )}
              </Show>
            </li>
          );
          return (
            <>
              <Card title="Company members" description="Who may mention the bot, and whose activity starts work automatically.">
                <Toggle
                  checked={configuration.memberAccess === "all_linked"}
                  onChange={(on) => state.edit({ ...configuration, memberAccess: on ? "all_linked" : "selected" })}
                  label="Allow mentions from every linked member"
                  description={configuration.memberAccess === "all_linked" ? "Includes members who link their GitHub account later." : "Only the members turned on below."}
                />
                <ul class="ch-list ch-people">
                  <For each={rows().members} fallback={<li class="cx-static">{links.isPending ? "Loading linked accounts…" : "No members linked yet."}</li>}>
                    {row}
                  </For>
                </ul>
                <div class="ch-inline">
                  <Button size="compact" icon={<Plus size={14} aria-hidden="true" />} onClick={() => setDialog("member")}>
                    Link a member
                  </Button>
                  <span class="cx-static">
                    {automatic() ? "Automatic runs follow the events and filters in Settings." : "Automatic runs are off in Settings; mentions still work."}
                  </span>
                </div>
              </Card>

              <Card title="Outside contributors" description="Specific GitHub users a member sponsors. They get restricted access, without company membership or the sponsor's credentials.">
                <ul class="ch-list ch-people">
                  <For each={rows().guests} fallback={<li class="cx-static">None yet.</li>}>
                    {row}
                  </For>
                </ul>
                <Show when={rows().guests.length > 0}>
                  <Toggle
                    checked={configuration.defaults.invocation === "allowed_authors"}
                    disabled={!automatic()}
                    onChange={(on) => state.edit({ ...configuration, defaults: { ...configuration.defaults, invocation: on ? "allowed_authors" : "linked_authors" } })}
                    label="Allow automatic runs for outside contributors"
                    description={automatic() ? "They can start the events and filters set in Settings." : "Turn on automatic runs in Settings first."}
                  />
                </Show>
                <div>
                  <Button size="compact" icon={<Plus size={14} aria-hidden="true" />} onClick={() => setDialog("guest")}>
                    Add an outside contributor
                  </Button>
                </div>
              </Card>

              <Card title="Responsible member" description="Accountable for tasks the bot creates automatically. GitHub authors are recorded separately; this gives no access to the member's credentials.">
                <select
                  class="input"
                  aria-label="Responsible member"
                  value={configuration.responsibleUserId}
                  onChange={(event) => state.edit({ ...configuration, responsibleUserId: event.currentTarget.value })}
                >
                  <Show when={!active().some((member) => member.principalId === configuration.responsibleUserId)}>
                    <option value={configuration.responsibleUserId}>{configuration.responsibleUserId || "Choose a member"}</option>
                  </Show>
                  <For each={active()}>{(member) => <option value={member.principalId}>{member.user?.name ?? member.user?.email ?? member.principalId}</option>}</For>
                </select>
              </Card>

              <Show when={!configuration.toolsEnabled}>
                <Card title="GitHub tools are off" description="This saved bot can't start work or answer until its GitHub tools are on.">
                  <div>
                    <Button size="compact" onClick={() => state.edit({ ...configuration, toolsEnabled: true })}>
                      Turn on the bot's tools
                    </Button>
                  </div>
                </Card>
              </Show>
              <Show when={props.endpoint.connectionId}>
                <A class="cx-link" href={`${props.base}/${props.endpoint.connectionId}/permissions`}>
                  Manage the bot's tool permissions
                </A>
              </Show>

              <GuestDialog
                open={dialog() === "guest"}
                onOpenChange={(open) => setDialog(open ? "guest" : null)}
                endpoint={props.endpoint}
                configuration={configuration}
                links={links.data ?? []}
                members={active()}
                onAdd={(person) => {
                  state.edit(withPerson(configuration, person));
                  setDialog(null);
                }}
              />
            </>
          );
        }}
      </ConfigurationGate>
      <Show when={members.isError || links.isError}>
        <p class="cx-note cx-note--error" role="alert">
          Couldn't load the members or linked accounts.
        </p>
      </Show>
      <Dialog open={dialog() === "member"} onOpenChange={(open) => setDialog(open ? "member" : null)} title="Link a company member" width={480}>
        <div class="ch-step-body">
          <p>Each member confirms their own GitHub account. Share this link with a member, or open it to link yours.</p>
          <A class={buttonClass({ size: "compact" })} href={linkHref()}>
            Link your GitHub account
          </A>
          <p class="mono ch-scopes">{`${window.location.origin}${linkHref()}`}</p>
        </div>
      </Dialog>
      <SaveBar state={state} />
    </>
  );
}

function GuestDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  endpoint: ChatEndpoint;
  configuration: GitHubChatConfiguration;
  links: { githubUserId?: string | null }[];
  members: { principalId: string; user: { name?: string | null; email?: string | null } | null }[];
  onAdd: (person: { kind: "guest"; githubUserId: string; login: string; sponsorUserId: string; permissionProfile: "restricted" }) => void;
}) {
  const [login, setLogin] = createSignal("");
  const [sponsor, setSponsor] = createSignal(props.configuration.responsibleUserId);
  const lookup = createMutation(() => ({
    mutationFn: () => githubChatApi.lookup(props.endpoint.id, login().trim()),
  }));
  const found = () => lookup.data ?? null;
  const listed = () =>
    Boolean(found() && (props.configuration.people.some((person) => person.githubUserId === found()!.githubUserId) || props.links.some((link) => link.githubUserId === found()!.githubUserId)));
  const sponsorOk = () => props.members.some((member) => member.principalId === sponsor());
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="Add an outside contributor"
      description="Let a GitHub user mention the bot. A company member sponsors their restricted access."
      width={480}
      footer={
        <>
          <Button variant="quiet" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!found() || listed() || !sponsorOk()}
            onClick={() => {
              props.onAdd({ kind: "guest", githubUserId: found()!.githubUserId, login: found()!.login, sponsorUserId: sponsor(), permissionProfile: "restricted" });
              setLogin("");
              lookup.reset();
            }}
          >
            Add contributor
          </Button>
        </>
      }
    >
      <div class="ch-step-body">
        <Field label="GitHub username" for="gh-guest-login">
          <div class="ch-inline">
            <TextInput
              id="gh-guest-login"
              placeholder="octocat"
              value={login()}
              onInput={(event) => {
                setLogin(event.currentTarget.value);
                lookup.reset();
              }}
            />
            <Button size="compact" disabled={lookup.isPending || !login().trim()} onClick={() => lookup.mutate()}>
              {lookup.isPending ? "Looking up…" : "Look up"}
            </Button>
          </div>
        </Field>
        <Field label="Sponsor" for="gh-guest-sponsor">
          <select id="gh-guest-sponsor" class="input" value={sponsor()} onChange={(event) => setSponsor(event.currentTarget.value)}>
            <Show when={!sponsorOk()}>
              <option value={sponsor()}>Choose a member</option>
            </Show>
            <For each={props.members}>{(member) => <option value={member.principalId}>{member.user?.name ?? member.user?.email ?? member.principalId}</option>}</For>
          </select>
        </Field>
        <Show when={found()}>
          <p role="status">{listed() ? `@${found()!.login} is already listed.` : `Found @${found()!.login}. They can mention the bot once you save.`}</p>
        </Show>
        <Show when={lookup.isError}>
          <p class="cx-note cx-note--error" role="alert">
            {failureText(lookup.error, "Couldn't find that user.")}
          </p>
        </Show>
      </div>
    </Dialog>
  );
}
