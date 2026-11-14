import type { AskUserQuestionsAnswer, IssueThreadInteraction, PaperclipQuestionSetQuestion } from "@paperclipai/shared";

/*
 * A question card's form when it carries its exact presentation (`payload.questionSet`,
 * `paperclip.question_set.v1`): a recovered harness question, or a connected app's form question
 * (MCP elicitation, U155, upstream #21466, doc/connections/MCP-ELICITATION.md). Its questions say
 * how they're answered (`answerMode`): one choice, any choices, or written text, with editable
 * starting text (`initialText`, never an answer by itself) and checks (`textValidation`: length,
 * a number or whole number in a range, a fixed-width pattern such as a date). Options can be
 * marked recommended (an app's default).
 *
 * The answers go back in the stored contract, as the old UI's IssueThreadInteractionCard sends
 * them: a written answer as `otherText` with no options, a choice as its option ids and any custom
 * text as `otherText`. The checks here run before sending; the server runs them again.
 */

export type QuestionAnswer = { text?: string; selectedOptionIds?: string[]; customText?: string };

/** The answers a form starts with: each written question's starting text, editable. */
export function startingAnswers(questions: readonly PaperclipQuestionSetQuestion[]): Record<string, QuestionAnswer> {
  const answers: Record<string, QuestionAnswer> = {};
  for (const question of questions) {
    if (question.answerMode === "text" && question.initialText !== undefined) answers[question.id] = { text: question.initialText };
  }
  return answers;
}

function hasValue(answer: QuestionAnswer | undefined) {
  return !!(answer?.text?.trim() || answer?.customText?.trim() || answer?.selectedOptionIds?.length);
}

/** What's wrong with an answer, in a few words, or null when it can be sent. */
export function answerError(question: PaperclipQuestionSetQuestion, answer: QuestionAnswer | undefined): string | null {
  if (question.required && !hasValue(answer)) return "This question needs an answer.";
  const value = question.answerMode === "text" ? answer?.text : answer?.customText;
  if (!value) return null;
  const validation = question.textValidation;
  if (!validation) return null;
  if (validation.minLength != null && value.length < validation.minLength) return `Enter at least ${validation.minLength} characters.`;
  if (validation.maxLength != null && value.length > validation.maxLength) return `Enter no more than ${validation.maxLength} characters.`;
  if (validation.pattern) {
    const result = matchPattern(validation.pattern, value);
    if (result === "unsupported") return "This question has a format Paperclip can't check.";
    if (result === "no_match") return "Use the format asked for.";
  }
  if (validation.inputType === "number" || validation.inputType === "integer") {
    const numeric = Number(value.trim());
    if (!value.trim() || !Number.isFinite(numeric) || (validation.inputType === "integer" && !Number.isInteger(numeric))) {
      return validation.inputType === "integer" ? "Enter a whole number." : "Enter a number.";
    }
    if (validation.minimum != null && numeric < validation.minimum) return `Enter ${validation.minimum} or more.`;
    if (validation.maximum != null && numeric > validation.maximum) return `Enter ${validation.maximum} or less.`;
  }
  return null;
}

/** The answers in the stored contract, one per question. */
export function toAnswers(questions: readonly PaperclipQuestionSetQuestion[], answers: Record<string, QuestionAnswer>): AskUserQuestionsAnswer[] {
  return questions.map((question) => {
    const answer = answers[question.id];
    if (question.answerMode === "text") {
      return { questionId: question.id, optionIds: [], ...(answer?.text !== undefined ? { otherText: answer.text } : {}) };
    }
    const custom = answer?.customText?.trim();
    return { questionId: question.id, optionIds: answer?.selectedOptionIds ?? [], ...(custom ? { otherText: custom } : {}) };
  });
}

/** How the question is answered, beside its prompt. */
export function answerHint(question: PaperclipQuestionSetQuestion): string {
  const kind = question.answerMode === "multi_select" ? "Pick any" : question.answerMode === "single_select" ? "Pick one" : "Write an answer";
  return question.required ? kind : `${kind} · optional`;
}

/** The keyboard a written answer wants. */
export function inputModeOf(question: PaperclipQuestionSetQuestion): "numeric" | "decimal" | undefined {
  const type = question.textValidation?.inputType;
  if (type === "integer") return (question.textValidation?.minimum ?? 0) < 0 ? undefined : "numeric";
  if (type === "number") return "decimal";
  return undefined;
}

/** A short written answer fits one line: a number, or text with a small maximum. */
export function oneLine(question: PaperclipQuestionSetQuestion): boolean {
  const validation = question.textValidation;
  if (validation?.inputType === "number" || validation?.inputType === "integer") return true;
  return validation?.maxLength != null && validation.maxLength <= 200;
}

/**
 * The connected app a card is asking for (an MCP form question, direct or from a background MCP
 * Task), by the card's key, as the server tells them apart (`isAppQuestionCardKey`); null for any
 * other card. Its name is in the title the server gives it, "<App> needs your input".
 */
export function appQuestion(interaction: Pick<IssueThreadInteraction, "kind" | "idempotencyKey" | "title">): { app: string } | null {
  if (interaction.kind !== "ask_user_questions") return null;
  const key = interaction.idempotencyKey;
  if (!key || !(key.startsWith("mcp-elicit:") || key.startsWith("mcp-task-input:") || key.startsWith("mcp-elicitation:"))) return null;
  const app = /^(.+?) needs your input$/.exec(interaction.title?.trim() ?? "")?.[1]?.trim();
  return { app: app || "The app" };
}

/*
 * A deliberately small, fixed-width subset of regular expressions, matched without JavaScript's
 * backtracking engine (after ui/src/components/task-chat/question-validation-pattern.ts): `^…$`
 * around literals, `.`, `\d \w \s` and their negations, and `[…]` classes. Anything else can't be
 * checked here and the server's check decides.
 */
type Matcher = (character: string) => boolean;

const UNSUPPORTED = new Set(["(", ")", "{", "}", "*", "+", "?", "|", "^", "$"]);

function escaped(token: string): Matcher {
  if (token === "d") return (c) => c >= "0" && c <= "9";
  if (token === "D") return (c) => c < "0" || c > "9";
  if (token === "w") return (c) => (c >= "0" && c <= "9") || (c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || c === "_";
  if (token === "W") {
    const word = escaped("w");
    return (c) => !word(c);
  }
  if (token === "s") return (c) => " \t\n\r\f\v".includes(c);
  if (token === "S") return (c) => !" \t\n\r\f\v".includes(c);
  return (c) => c === token;
}

function characterClass(source: string, start: number): { matcher: Matcher; next: number } | null {
  let cursor = start;
  const negated = source[cursor] === "^";
  if (negated) cursor += 1;
  const ranges: [number, number][] = [];
  const read = (): string | null => {
    if (cursor >= source.length || source[cursor] === "]") return null;
    const current = source[cursor++]!;
    if (current !== "\\") return current;
    if (cursor >= source.length) return null;
    const next = source[cursor++]!;
    return "dDsSwW".includes(next) ? null : next;
  };
  while (cursor < source.length && source[cursor] !== "]") {
    const first = read();
    if (first === null) return null;
    if (source[cursor] === "-" && cursor + 1 < source.length && source[cursor + 1] !== "]") {
      cursor += 1;
      const last = read();
      if (last === null || first.charCodeAt(0) > last.charCodeAt(0)) return null;
      ranges.push([first.charCodeAt(0), last.charCodeAt(0)]);
    } else ranges.push([first.charCodeAt(0), first.charCodeAt(0)]);
  }
  if (source[cursor] !== "]" || ranges.length === 0) return null;
  return {
    next: cursor + 1,
    matcher: (c) => {
      const code = c.charCodeAt(0);
      const inside = ranges.some(([first, last]) => code >= first && code <= last);
      return negated ? !inside : inside;
    },
  };
}

export function matchPattern(pattern: string, value: string): "match" | "no_match" | "unsupported" {
  if (pattern.length < 2 || pattern.length > 256 || !pattern.startsWith("^") || !pattern.endsWith("$")) return "unsupported";
  const source = pattern.slice(1, -1);
  const matchers: Matcher[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const token = source[cursor++]!;
    if (UNSUPPORTED.has(token) || token === "]") return "unsupported";
    if (token === "[") {
      const parsed = characterClass(source, cursor);
      if (!parsed) return "unsupported";
      matchers.push(parsed.matcher);
      cursor = parsed.next;
    } else if (token === "\\") {
      if (cursor >= source.length) return "unsupported";
      matchers.push(escaped(source[cursor++]!));
    } else if (token === ".") {
      matchers.push((c) => !["\n", "\r", " ", " "].includes(c));
    } else {
      matchers.push((c) => c === token);
    }
  }
  if (value.length !== matchers.length) return "no_match";
  return matchers.every((matcher, index) => matcher(value[index]!)) ? "match" : "no_match";
}
