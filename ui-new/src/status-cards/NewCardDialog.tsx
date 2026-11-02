import type { StatusCard } from "@paperclipai/shared";
import { createSignal, For, Show } from "solid-js";
import { statusCardsApi } from "@/api/status-cards";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Field, TextArea } from "@/ui/Field";
import { useCardAgentChecks } from "./agent-checks";
import { AgentNotice, AgentPicker } from "./AgentPicker";
import { blocksCreate } from "./card-agent-model";
import { useRefreshCards } from "./queries";
import { defaultPolicy, isSummarizerMissing } from "./status-model";

/*
 * New card (after ui/src/pages/StatusCards/CreateStatusCardDialog.tsx): one prompt sets up the whole
 * card, what to watch and what each update should say, plus the agent that runs it. Creating it
 * starts the setup at once (the agent builds the query, then the first summary). New cards update
 * manually until their settings say otherwise.
 *
 * Without a chosen agent the company's built-in Summarizer runs the card. The server refuses the
 * card unless the Summarizer is set up and ready (built-in agents are a separate experimental
 * setting), so the dialog says so before Create, offers to set it up, and holds Create back; the
 * same goes for an agent that can never write a card. Other problems (a paused agent, a harness
 * without a run key) are warnings: the card can be created, and waits (card-agent-model.ts).
 */

const EXAMPLES = ["Tasks about evals", "Everything blocked this week", "Is the new sign-in flow live? If not, the next three steps to ship it"];

export function NewCardDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (card: StatusCard) => void }) {
  const company = useCompany();
  const refresh = useRefreshCards();
  const [prompt, setPrompt] = createSignal("");
  const [agentId, setAgentId] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const checks = useCardAgentChecks();
  const agentCheck = () => checks.check(agentId());
  const blocked = () => blocksCreate(agentCheck());
  let promptField: HTMLTextAreaElement | undefined;

  const close = () => {
    props.onOpenChange(false);
    setPrompt("");
    setAgentId("");
    setError(null);
  };

  const create = async (event?: Event) => {
    event?.preventDefault();
    if (!prompt().trim() || busy() || blocked()) return;
    setBusy(true);
    setError(null);
    try {
      const card = await statusCardsApi.create(company().id, {
        interestPrompt: prompt().trim(),
        titlePinned: false,
        agentId: agentId() || null,
        refreshPolicy: defaultPolicy(),
      });
      void refresh();
      props.onCreated(card);
      close();
    } catch (caught) {
      setError(
        isSummarizerMissing(caught)
          ? "This company has no Summarizer set up. Choose an agent to run the card."
          : caught instanceof Error
            ? caught.message
            : String(caught),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => (open ? props.onOpenChange(true) : close())}
      title="New card"
      description="Say what to keep an eye on and what each update should tell you. The agent builds the query from it and writes every update to it."
      width={640}
      initialFocus={() => promptField}
      footer={
        <>
          <Button variant="quiet" onClick={close} disabled={busy()}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!prompt().trim() || busy() || blocked()} onClick={() => void create()}>
            {busy() ? "Creating…" : "Create card"}
          </Button>
        </>
      }
    >
      <form class="sc-new" onSubmit={(event) => void create(event)}>
        <Field label="What do you want to keep an eye on?" for="sc-new-prompt">
          <TextArea
            ref={promptField}
            id="sc-new-prompt"
            rows={5}
            value={prompt()}
            placeholder="Keep an eye on the ID and Cloud projects. Tell me whether the service is live, and if not, the three things needed to ship it."
            onInput={(event) => setPrompt(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void create(event);
            }}
          />
        </Field>
        <div class="sc-examples">
          <span class="lbl">Examples</span>
          <For each={EXAMPLES}>
            {(example) => (
              <Button size="compact" variant="well" onClick={() => setPrompt(example)}>
                {example}
              </Button>
            )}
          </For>
        </div>
        <Field label="Agent" for="sc-new-agent" help="Runs the card's setup and updates. Each run is a real agent run and costs tokens.">
          <AgentPicker id="sc-new-agent" value={agentId()} onChange={setAgentId} />
        </Field>
        <AgentNotice agentId={agentId()} check={agentCheck()} />
        <Show when={error()}>
          <p class="field-error" role="alert">
            {error()}
          </p>
        </Show>
      </form>
    </Dialog>
  );
}
