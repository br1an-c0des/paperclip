import { ChevronRight, Copy } from "lucide-solid";
import { For, Show, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { InfoTip } from "@/ui/InfoTip";
import { pushToast } from "@/ui/Toast";
import type { PromptViewGroup, PromptViewPart, PromptViewSection, PromptView } from "./prompt-sections";
import "./PromptSections.css";

/*
 * A prompt in labelled sections (step 5): the system prompt Paperclip added, then the first message.
 * Each section is folded to one line (label, why it's there, where its text comes from, its size and
 * which sessions get it) and unfolds to its text, or to its parts when it has them. The run modal's
 * Input tab shows a past run's record here; the agent's run preview shows a draft, whose `pending`
 * values it marks through `renderPending`. The styles are its own, so it works outside the run modal.
 */

export type PromptSectionsProps = {
  view: PromptView;
  /** Marks a draft's value that's filled in at launch (the run preview). Nothing by default. */
  renderPending?: (pending: string) => JSX.Element;
  /** Prefixes the headings' ids, when more than one of these is on a page. */
  idPrefix?: string;
  /** The level of the two group headings (System prompt, First message); 3 by default. */
  headingLevel?: 3 | 4 | 5;
};

const GROUP_INFO: Record<PromptViewGroup["placement"], string> = {
  system:
    "What Paperclip added to Claude's own system prompt. Claude keeps a session's system prompt from its start, so a resumed session isn't sent it again.",
  first_message: "The message that starts the run: these sections in order, joined with a blank line.",
};

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    pushToast({ tone: "success", title: `Copied the ${what}` });
  } catch {
    pushToast({ tone: "error", title: `Couldn't copy the ${what}` });
  }
}

export function PromptSections(props: PromptSectionsProps) {
  const id = (name: string) => `${props.idPrefix ?? "ps"}-${name}`;
  const pending = (value: string | null) => (value && props.renderPending ? props.renderPending(value) : null);
  return (
    <div class="ps">
      <Show when={!props.view.matchedPlan}>
        <p class="ps-note ps-note--warn" role="note">
          Paperclip's sections didn't match the prompt it sent, so the first message below is the sent text, whole.
        </p>
      </Show>
      <For each={props.view.groups}>
        {(group) => (
          <section class="ps-group" aria-labelledby={id(group.placement)}>
            <div class="ps-grouph">
              <Dynamic component={`h${props.headingLevel ?? 3}`} class="disp ps-grouptitle" id={id(group.placement)}>
                {group.title}
              </Dynamic>
              <InfoTip label={`About ${group.title}`}>{GROUP_INFO[group.placement]}</InfoTip>
              <Show when={group.size}>
                {(size) => (
                  <span class="cap">
                    {size()}
                    {group.sections.length > 1 ? ` · ${group.sections.length} sections` : ""}
                  </span>
                )}
              </Show>
              <Show when={group.placement === "first_message" && props.view.firstMessageText}>
                <button type="button" class="ps-b" onClick={() => void copy(props.view.firstMessageText, "first message")}>
                  <Copy size={13} aria-hidden="true" />
                  Copy
                </button>
              </Show>
            </div>
            <Show when={group.placement === "first_message" && props.view.truncatedChars}>
              {(omitted) => (
                <p class="ps-note">
                  Cut when it was stored: the last {omitted().toLocaleString()} characters weren't kept.
                </p>
              )}
            </Show>
            <Show when={group.sections.length > 0} fallback={<p class="ps-empty">{group.note}</p>}>
              <div class="ps-list">
                <For each={group.sections}>{(section) => <Section section={section} pending={pending} />}</For>
              </div>
            </Show>
          </section>
        )}
      </For>
    </div>
  );
}

function Section(props: { section: PromptViewSection; pending: (value: string | null) => JSX.Element }) {
  return (
    <details class="ps-sec" data-section={props.section.id}>
      <summary>
        <ChevronRight size={13} class="ps-chev" aria-hidden="true" />
        <span class="ps-label">{props.section.label}</span>
        <InfoTip label={`About ${props.section.label}`}>{props.section.info}</InfoTip>
        <Show when={props.section.reason}>
          <span class="ps-reason">{props.section.reason}</span>
        </Show>
        <span class="ps-meta cap">
          <Show when={props.section.source}>
            <span class="mono">{props.section.source}</span>
            {" · "}
          </Show>
          {props.section.size}
          <Show when={props.section.delivery}>{(delivery) => <> · {delivery()}</>}</Show>
        </span>
        {props.pending(props.section.pending)}
      </summary>
      <div class="ps-body">
        <Show when={props.section.parts.length > 0} fallback={<SectionText text={props.section.text} />}>
          <For each={props.section.parts}>{(part) => <Part part={part} pending={props.pending} />}</For>
        </Show>
      </div>
    </details>
  );
}

function Part(props: { part: PromptViewPart; pending: (value: string | null) => JSX.Element }) {
  return (
    <div class="ps-part" data-part={props.part.id}>
      <div class="ps-parth">
        <span class="ps-part-label">{props.part.label}</span>
        <span class="cap">
          <Show when={props.part.source}>
            <span class="mono">{props.part.source}</span>
            {" · "}
          </Show>
          {props.part.size}
        </span>
        {props.pending(props.part.pending)}
      </div>
      <SectionText text={props.part.text} />
    </div>
  );
}

function SectionText(props: { text: string }) {
  return (
    <Show when={props.text} fallback={<p class="ps-empty">Empty</p>}>
      <pre class="ps-pre">{props.text}</pre>
    </Show>
  );
}
