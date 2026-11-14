import type { PaperclipQuestionSetQuestion } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { answerError, answerHint, appQuestion, inputModeOf, matchPattern, oneLine, startingAnswers, toAnswers } from "./question-set";

const text = (extra: Partial<PaperclipQuestionSetQuestion> = {}): PaperclipQuestionSetQuestion => ({ id: "title", prompt: "Ticket title", required: true, answerMode: "text", ...extra });
const choice = (extra: Partial<PaperclipQuestionSetQuestion> = {}): PaperclipQuestionSetQuestion => ({
  id: "priority",
  prompt: "Priority",
  required: true,
  answerMode: "single_select",
  options: [{ id: "choice_1", label: "Urgent" }, { id: "choice_2", label: "Normal", recommended: true }],
  ...extra,
});

describe("a question set's answers (U155, #21466)", () => {
  it("starts written questions with their starting text, and nothing else", () => {
    expect(startingAnswers([text({ initialText: "Login button does nothing" }), text({ id: "notes" }), choice()])).toEqual({ title: { text: "Login button does nothing" } });
  });

  it("asks for required answers and checks text length", () => {
    const question = text({ textValidation: { minLength: 3, maxLength: 10 } });
    expect(answerError(question, undefined)).toBe("This question needs an answer.");
    expect(answerError(question, { text: "   " })).toBe("This question needs an answer.");
    expect(answerError(question, { text: "ab" })).toBe("Enter at least 3 characters.");
    expect(answerError(question, { text: "a much longer title" })).toBe("Enter no more than 10 characters.");
    expect(answerError(question, { text: "Login" })).toBeNull();
    expect(answerError(text({ required: false }), undefined)).toBeNull();
    expect(answerError(choice(), { selectedOptionIds: ["choice_1"] })).toBeNull();
    expect(answerError(choice(), { selectedOptionIds: [] })).toBe("This question needs an answer.");
  });

  it("checks numbers, whole numbers and their range", () => {
    const points = text({ required: false, textValidation: { inputType: "integer", minimum: 1, maximum: 8 } });
    expect(answerError(points, { text: "" })).toBeNull();
    expect(answerError(points, { text: "2.5" })).toBe("Enter a whole number.");
    expect(answerError(points, { text: "abc" })).toBe("Enter a whole number.");
    expect(answerError(points, { text: "0" })).toBe("Enter 1 or more.");
    expect(answerError(points, { text: "9" })).toBe("Enter 8 or less.");
    expect(answerError(points, { text: " 3 " })).toBeNull();
    expect(answerError(text({ textValidation: { inputType: "number" } }), { text: "2.5" })).toBeNull();
    expect(answerError(text({ textValidation: { inputType: "number" } }), { text: "two" })).toBe("Enter a number.");
  });

  it("checks a date with the server's fixed-width pattern, without running a regular expression", () => {
    const date = "^\\d\\d\\d\\d-\\d\\d-\\d\\d$";
    expect(matchPattern(date, "2026-11-13")).toBe("match");
    expect(matchPattern(date, "2026-1-13")).toBe("no_match");
    expect(matchPattern(date, "2026/11/13")).toBe("no_match");
    expect(matchPattern("^[A-Z][a-z]$", "Ab")).toBe("match");
    expect(matchPattern("^[^0-9].$", "1b")).toBe("no_match");
    expect(matchPattern("^(a+)+$", "aaa")).toBe("unsupported");
    expect(matchPattern("\\d", "1")).toBe("unsupported");
    expect(answerError(text({ textValidation: { pattern: date } }), { text: "13 Nov" })).toBe("Use the format asked for.");
    expect(answerError(text({ textValidation: { pattern: "^a*$" } }), { text: "aa" })).toBe("This question has a format Paperclip can't check.");
  });

  it("sends a written answer as text with no options, and a choice as its ids with any custom text", () => {
    const questions = [text(), choice({ customAnswer: { enabled: true } }), choice({ id: "labels", answerMode: "multi_select", required: false }), text({ id: "estimate", required: false })];
    expect(
      toAnswers(questions, {
        title: { text: "Login button does nothing on Safari" },
        priority: { selectedOptionIds: [], customText: "  Soon " },
        labels: { selectedOptionIds: ["choice_1", "choice_2"] },
      }),
    ).toEqual([
      { questionId: "title", optionIds: [], otherText: "Login button does nothing on Safari" },
      { questionId: "priority", optionIds: [], otherText: "Soon" },
      { questionId: "labels", optionIds: ["choice_1", "choice_2"] },
      { questionId: "estimate", optionIds: [] },
    ]);
  });

  it("says how each question is answered, and which fit one line", () => {
    expect(answerHint(choice())).toBe("Pick one");
    expect(answerHint(choice({ answerMode: "multi_select", required: false }))).toBe("Pick any · optional");
    expect(answerHint(text())).toBe("Write an answer");
    expect(inputModeOf(text({ textValidation: { inputType: "integer", minimum: 1 } }))).toBe("numeric");
    expect(inputModeOf(text({ textValidation: { inputType: "integer", minimum: -5 } }))).toBeUndefined();
    expect(inputModeOf(text({ textValidation: { inputType: "number" } }))).toBe("decimal");
    expect(oneLine(text({ textValidation: { maxLength: 80 } }))).toBe(true);
    expect(oneLine(text())).toBe(false);
  });
});

describe("an app's question card", () => {
  it("is told apart by its key, and names the app from its title", () => {
    const card = { kind: "ask_user_questions" as const, idempotencyKey: "mcp-elicit:abc:0", title: "Linear needs your input" };
    expect(appQuestion(card)).toEqual({ app: "Linear" });
    expect(appQuestion({ ...card, idempotencyKey: "mcp-task-input:abc" })).toEqual({ app: "Linear" });
    expect(appQuestion({ ...card, title: "Something else" })).toEqual({ app: "The app" });
    expect(appQuestion({ ...card, idempotencyKey: "agent-question:1" })).toBeNull();
    expect(appQuestion({ ...card, idempotencyKey: null })).toBeNull();
    expect(appQuestion({ ...card, kind: "request_confirmation" })).toBeNull();
  });
});
