import type { CompanyMcpSkill } from "@paperclipai/shared";
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { createMemo, createSignal, For, Show } from "solid-js";
import { mcpSkillsApi } from "@/api/mcp-skills";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { describeError } from "@/lib/offline/errors";
import { Button } from "@/ui/Button";
import { InfoTip } from "@/ui/InfoTip";
import { TonePill } from "@/ui/Status";
import { pushToast } from "@/ui/Toast";
import { canApprove, connectedSkillNote, previewCurrent, reviewable, sizeLine, sortConnectedSkills, STATUS_LABEL, STATUS_TONE, waitingLine, type SkillPreview } from "./connected-skills-model";

/*
 * Connected app skills (U137, upstream #21219): skills a connected app publishes over MCP, at the top
 * of the Library while there are any. Each waits for the board's review; agents that use the app get
 * an approved skill. A skill's row shows its app, state, size and the reason for its state; "Read
 * instructions" shows its SKILL.md as plain text (it comes from the app, so it's never rendered);
 * Approve binds the approval to the manifest digest on screen, and "Also let it use" grants the tools
 * the skill asks for. Decline sets a waiting skill aside; Turn off declines an approved one.
 *
 * The section stays out of the way when no app publishes skills (an empty list renders nothing).
 */

export function ConnectedAppSkills() {
  const company = useCompany();
  const client = useQueryClient();
  const list = createQuery(() => ({
    queryKey: queryKeys.skills.mcp(company().id),
    queryFn: ({ signal }) => mcpSkillsApi.list(company().id, signal),
    staleTime: 30_000,
    retry: false,
  }));
  const skills = createMemo(() => sortConnectedSkills(list.data ?? []));
  const [openId, setOpenId] = createSignal<string | null>(null);
  const [allowTools, setAllowTools] = createSignal<Record<string, boolean>>({});
  const openSkill = createMemo(() => skills().find((skill) => skill.id === openId()) ?? null);
  const content = createQuery(() => ({
    queryKey: queryKeys.skills.mcpContent(company().id, openId() ?? "", openSkill()?.manifestDigest ?? ""),
    queryFn: ({ signal }) => mcpSkillsApi.content(company().id, openId()!, signal),
    enabled: Boolean(openId() && openSkill()?.manifestDigest),
    retry: false,
  }));
  const preview = (): SkillPreview | null =>
    openId()
      ? {
          skillId: openId()!,
          manifestDigest: content.data?.manifestDigest,
          markdown: content.data?.markdown,
          loading: content.isLoading,
          error: content.isError ? describeError(content.error, "Couldn't load the instructions.") : undefined,
        }
      : null;

  const refresh = () => client.invalidateQueries({ queryKey: queryKeys.skills.mcp(company().id) });
  const failed = (title: string) => (error: unknown) => {
    pushToast({ tone: "error", title, body: describeError(error, "") || undefined });
    void refresh();
  };
  const approve = createMutation(() => ({
    mutationFn: (input: { skill: CompanyMcpSkill; allowTools: boolean }) =>
      mcpSkillsApi.approve(company().id, input.skill.id, { manifestDigest: input.skill.manifestDigest!, allowTools: input.allowTools }),
    onSuccess: (_result: unknown, input: { skill: CompanyMcpSkill; allowTools: boolean }) => {
      pushToast({ tone: "success", title: `Approved ${input.skill.name}`, body: `Agents that use ${input.skill.appName} can follow it.` });
      void refresh();
    },
    onError: failed("Couldn't approve the skill"),
  }));
  const decline = createMutation(() => ({
    mutationFn: (skill: CompanyMcpSkill) => mcpSkillsApi.decline(company().id, skill.id),
    onSuccess: (_result: unknown, skill: CompanyMcpSkill) => {
      pushToast({ tone: "info", title: skill.status === "approved" ? `Turned off ${skill.name}` : `Declined ${skill.name}` });
      void refresh();
    },
    onError: failed("Couldn't update the skill"),
  }));
  const busyId = () => (approve.isPending ? approve.variables?.skill.id : decline.isPending ? decline.variables?.id : null) ?? null;

  return (
    <>
      <Show when={list.isError}>
        <p class="org-muted sk-mcp-error" role="alert">
          Couldn't load skills from connected apps. {describeError(list.error, "")}
        </p>
      </Show>
      <Show when={skills().length > 0}>
        <section class="card org-card sk-mcp" aria-labelledby="sk-mcp-heading">
          <div class="org-card-row">
            <h2 class="disp" id="sk-mcp-heading">
              Connected app skills
            </h2>
            <InfoTip label="About connected app skills">
              Apps you connect can publish skills next to their tools. Agents that use an app get its skills only after you approve them.
            </InfoTip>
            <Show when={waitingLine(skills())}>{(line) => <span class="org-muted org-push">{line()}</span>}</Show>
          </div>
          <ul class="sk-mcp-list">
            <For each={skills()}>
              {(skill) => {
                const open = () => openId() === skill.id;
                const busy = () => busyId() === skill.id;
                return (
                  <li class="sk-mcp-row">
                    <div class="sk-mcp-head">
                      <span class="org-strong sk-mcp-name">{skill.name}</span>
                      <span class="org-muted">from {skill.appName}</span>
                      <TonePill tone={STATUS_TONE[skill.status]} compact>
                        {STATUS_LABEL[skill.status]}
                      </TonePill>
                      <Show when={sizeLine(skill)}>{(line) => <span class="org-muted sk-mcp-size">{line()}</span>}</Show>
                    </div>
                    <p class="sk-mcp-desc">{skill.description}</p>
                    <Show when={connectedSkillNote(skill)}>{(note) => <p class="sk-mcp-note">{note()}</p>}</Show>
                    <Show when={skill.nameCollision}>
                      <p class="org-muted sk-mcp-small">Another skill uses this name. Agents get this one under {skill.appName}'s name, so neither replaces the other.</p>
                    </Show>
                    <Show when={skill.requestedTools.length > 0}>
                      <Show
                        when={reviewable(skill)}
                        fallback={
                          <p class="org-muted sk-mcp-small">
                            {skill.allowedToolsApproved ? "Can use" : "Asked to use, not allowed"}: <span class="mono">{skill.requestedTools.join(", ")}</span>
                          </p>
                        }
                      >
                        <label class="sk-mcp-tools">
                          <input
                            type="checkbox"
                            checked={allowTools()[skill.id] === true}
                            disabled={busy()}
                            onChange={(event) => setAllowTools((current) => ({ ...current, [skill.id]: event.currentTarget.checked }))}
                          />
                          <span>
                            Also let it use <span class="mono">{skill.requestedTools.join(", ")}</span>
                          </span>
                        </label>
                      </Show>
                    </Show>
                    <Show when={skill.status !== "unavailable"}>
                      <div class="org-row sk-mcp-actions">
                        <Button size="compact" variant="quiet" aria-expanded={open()} onClick={() => setOpenId(open() ? null : skill.id)}>
                          {open() ? "Hide instructions" : "Read instructions"}
                        </Button>
                        <Show when={reviewable(skill)}>
                          <Button
                            size="compact"
                            variant="primary"
                            disabled={!canApprove(skill, preview(), busyId() !== null)}
                            onClick={() => approve.mutate({ skill, allowTools: allowTools()[skill.id] === true })}
                          >
                            {busy() && approve.isPending ? "Approving…" : "Approve"}
                          </Button>
                          <InfoTip label={`About approving ${skill.name}`}>
                            Approving lets agents that use {skill.appName} follow these instructions, including commands they describe. A changed skill comes back for review.
                          </InfoTip>
                        </Show>
                        <Show when={skill.status !== "declined"}>
                          <Button size="compact" disabled={busyId() !== null} onClick={() => decline.mutate(skill)}>
                            {skill.status === "approved" ? "Turn off" : "Decline"}
                          </Button>
                        </Show>
                      </div>
                    </Show>
                    <Show when={open()}>
                      <Show
                        when={!preview()?.error}
                        fallback={
                          <p class="sk-mcp-note sk-mcp-note--error" role="alert">
                            {preview()?.error}
                          </p>
                        }
                      >
                        <Show when={previewCurrent(skill, preview())} fallback={<p class="org-muted sk-mcp-small">{skill.manifestDigest ? "Loading the instructions…" : "Paperclip can't show this skill's instructions."}</p>}>
                          {/* Plain text: the content comes from the app and is never rendered as a page. */}
                          <pre class="mono sk-mcp-pre">{preview()?.markdown}</pre>
                        </Show>
                      </Show>
                    </Show>
                  </li>
                );
              }}
            </For>
          </ul>
        </section>
      </Show>
    </>
  );
}
