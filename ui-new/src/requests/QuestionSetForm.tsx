import type { AskUserQuestionsAnswer, PaperclipQuestionSetPayload, PaperclipQuestionSetQuestion } from "@paperclipai/shared";
import { Check } from "lucide-solid";
import { createMemo, createSignal, For, Show } from "solid-js";
import { Button } from "@/ui/Button";
import { TextArea, TextInput } from "@/ui/Field";
import { Footer } from "./card-parts";
import { answerError, answerHint, inputModeOf, oneLine, startingAnswers, toAnswers, type QuestionAnswer } from "./question-set";
import type { Request } from "./request-model";

/*
 * The form of a question card that carries its exact presentation (question-set.ts): an app's form
 * question (MCP elicitation, U155) or a recovered harness question. Every question shows at once,
 * as in the card's other forms: a choice as radios or chips (an app's default marked
 * "Recommended"), a written answer as a field that starts with the question's starting text, a
 * custom answer when the question takes one. Sending checks every answer first and marks the ones
 * that need attention; the server checks them again. An app's question also has Skip, which
 * declines it (`…/skip`) and wakes the agent to tell the app.
 */
export function QuestionSetForm(props: {
  request: Request;
  questionSet: PaperclipQuestionSetPayload;
  /** The card's own submit label, when the question set has none. */
  submitLabel?: string | null;
  busy: boolean;
  error: string | null;
  onSubmit: (answers: AskUserQuestionsAnswer[]) => void;
  /** Declines the question (an app's question). */
  onSkip?: () => void;
}) {
  const questions = () => props.questionSet.questions;
  // Starting text is a draft: set once, so a refresh of the card never replaces what you typed.
  const [answers, setAnswers] = createSignal<Record<string, QuestionAnswer>>(startingAnswers(props.questionSet.questions));
  const [custom, setCustom] = createSignal<Record<string, boolean>>({});
  const [attempted, setAttempted] = createSignal(false);
  const errors = createMemo(() => Object.fromEntries(questions().map((question) => [question.id, answerError(question, answers()[question.id])] as const)));
  const invalid = () => questions().filter((question) => errors()[question.id]).length;

  const update = (questionId: string, change: (answer: QuestionAnswer) => QuestionAnswer) =>
    setAnswers((current) => ({ ...current, [questionId]: change(current[questionId] ?? {}) }));
  const toggle = (question: PaperclipQuestionSetQuestion, optionId: string) => {
    const multi = question.answerMode === "multi_select";
    update(question.id, (answer) => {
      const now = answer.selectedOptionIds ?? [];
      if (multi) return { ...answer, selectedOptionIds: now.includes(optionId) ? now.filter((id) => id !== optionId) : [...now, optionId] };
      // One choice: a picked option replaces a custom answer.
      return { selectedOptionIds: [optionId] };
    });
    if (!multi) setCustom((current) => ({ ...current, [question.id]: false }));
  };
  const toggleCustom = (question: PaperclipQuestionSetQuestion) => {
    const multi = question.answerMode === "multi_select";
    const active = !multi || !custom()[question.id];
    setCustom((current) => ({ ...current, [question.id]: active }));
    update(question.id, (answer) => ({
      ...answer,
      ...(!multi && active ? { selectedOptionIds: [] } : {}),
      customText: active ? (answer.customText ?? "") : undefined,
    }));
  };
  const send = () => {
    if (props.busy) return;
    if (invalid() > 0) {
      setAttempted(true);
      return;
    }
    props.onSubmit(toAnswers(questions(), answers()));
  };
  const shownError = () =>
    props.error ?? (attempted() && invalid() > 0 ? (invalid() === 1 ? "One answer needs attention." : `${invalid()} answers need attention.`) : null);
  const label = () => props.questionSet.submitLabel?.trim() || props.submitLabel?.trim() || (questions().length > 1 ? "Send answers" : "Send answer");

  return (
    <>
      <For each={questions()}>
        {(question, index) => {
          const fieldId = () => `${props.request.key.replace(/[^\w-]/g, "-")}-q${index()}`;
          const error = () => (attempted() ? errors()[question.id] : null);
          const selected = (optionId: string) => answers()[question.id]?.selectedOptionIds?.includes(optionId) ?? false;
          const multi = question.answerMode === "multi_select";
          return (
            <div class="rq-qs" role="group" aria-labelledby={`${fieldId()}-prompt`}>
              <div class="rq-q" id={`${fieldId()}-prompt`} classList={{ "sr-only": questions().length === 1 && question.prompt.trim() === props.request.title.trim() }}>
                {question.header ? <span class="rq-q-header">{question.header} · </span> : null}
                {question.prompt}
                <small>{answerHint(question)}</small>
              </div>
              <Show when={question.helpText}>
                <p class="rq-help">{question.helpText}</p>
              </Show>
              <Show
                when={question.answerMode !== "text"}
                fallback={
                  <Show
                    when={oneLine(question)}
                    fallback={
                      <TextArea
                        id={fieldId()}
                        aria-labelledby={`${fieldId()}-prompt`}
                        aria-describedby={error() ? `${fieldId()}-error` : undefined}
                        invalid={!!error()}
                        rows={3}
                        placeholder="Write your answer"
                        value={answers()[question.id]?.text ?? ""}
                        disabled={props.busy}
                        onInput={(event) => {
                          const value = event.currentTarget.value;
                          update(question.id, () => ({ text: value }));
                        }}
                      />
                    }
                  >
                    <TextInput
                      id={fieldId()}
                      aria-labelledby={`${fieldId()}-prompt`}
                      aria-describedby={error() ? `${fieldId()}-error` : undefined}
                      invalid={!!error()}
                      inputMode={inputModeOf(question)}
                      placeholder={inputModeOf(question) ? "Enter a number" : "Write your answer"}
                      value={answers()[question.id]?.text ?? ""}
                      disabled={props.busy}
                      onInput={(event) => {
                        const value = event.currentTarget.value;
                        update(question.id, () => ({ text: value }));
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.isComposing) {
                          event.preventDefault();
                          send();
                        }
                      }}
                    />
                  </Show>
                }
              >
                <Show
                  when={multi}
                  fallback={
                    <div class="rq-opts" role="radiogroup" aria-labelledby={`${fieldId()}-prompt`}>
                      <For each={question.options ?? []}>
                        {(option) => (
                          <button type="button" class="rq-opt" role="radio" aria-checked={selected(option.id)} disabled={props.busy} onClick={() => toggle(question, option.id)}>
                            <span class="rq-radio" aria-hidden="true" />
                            <span class="rq-opt-main">
                              {option.label}
                              <Show when={option.recommended}>
                                <span class="rq-rec">Recommended</span>
                              </Show>
                              <Show when={option.description}>
                                <small>{option.description}</small>
                              </Show>
                            </span>
                          </button>
                        )}
                      </For>
                      <Show when={question.customAnswer?.enabled}>
                        <button type="button" class="rq-opt" role="radio" aria-checked={!!custom()[question.id]} disabled={props.busy} onClick={() => toggleCustom(question)}>
                          <span class="rq-radio" aria-hidden="true" />
                          <span class="rq-opt-main">{question.customAnswer?.label || "Other"}</span>
                        </button>
                      </Show>
                    </div>
                  }
                >
                  <div class="rq-chips" role="group" aria-labelledby={`${fieldId()}-prompt`}>
                    <For each={question.options ?? []}>
                      {(option) => (
                        <button
                          type="button"
                          class="rq-chip"
                          aria-pressed={selected(option.id)}
                          title={option.description ?? undefined}
                          disabled={props.busy}
                          onClick={() => toggle(question, option.id)}
                        >
                          <Show when={selected(option.id)}>
                            <Check size={13} aria-hidden="true" />
                          </Show>
                          {option.label}
                          <Show when={option.recommended}>
                            <span class="rq-rec">Recommended</span>
                          </Show>
                        </button>
                      )}
                    </For>
                    <Show when={question.customAnswer?.enabled}>
                      <button type="button" class="rq-chip" aria-pressed={!!custom()[question.id]} disabled={props.busy} onClick={() => toggleCustom(question)}>
                        {question.customAnswer?.label || "Other"}
                      </button>
                    </Show>
                  </div>
                </Show>
                <Show when={custom()[question.id]}>
                  <TextInput
                    aria-label={`${question.customAnswer?.label || "Other"}: ${question.prompt}`}
                    aria-describedby={error() ? `${fieldId()}-error` : undefined}
                    invalid={!!error()}
                    placeholder={question.customAnswer?.placeholder ?? "Type your answer"}
                    value={answers()[question.id]?.customText ?? ""}
                    disabled={props.busy}
                    onInput={(event) => {
                      const value = event.currentTarget.value;
                      update(question.id, (answer) => ({ ...answer, customText: value }));
                    }}
                  />
                </Show>
              </Show>
              <Show when={error()}>
                <p class="rq-error rq-field-error" id={`${fieldId()}-error`}>
                  {error()}
                </p>
              </Show>
            </div>
          );
        }}
      </For>
      <Footer request={props.request} error={shownError()}>
        <Show when={props.onSkip}>
          <Button size="compact" disabled={props.busy} onClick={() => props.onSkip?.()}>
            Skip
          </Button>
        </Show>
        <Button size="compact" variant="primary" disabled={props.busy} onClick={send}>
          {label()}
        </Button>
      </Footer>
    </>
  );
}
