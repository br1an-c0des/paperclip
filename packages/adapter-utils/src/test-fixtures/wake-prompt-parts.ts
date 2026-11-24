import type * as ServerUtils from "../server-utils.js";

type Renderer = typeof ServerUtils.renderPaperclipWakePrompt;

/** How many renders the wrapper below has checked, per test file. */
export const wakePromptPartsChecks = { count: 0 };

/**
 * Wraps `renderPaperclipWakePrompt` so that every render a test makes also checks the display
 * parts: they must concatenate to exactly the text the renderer returns (step 5, Task 2). Used by
 * the renderer's test files through `vi.mock`, so their existing fixtures are the corpus.
 */
export function checkedWakePromptRenderer(actual: typeof ServerUtils): Renderer {
  return (value, options) => {
    const text = actual.renderPaperclipWakePrompt(value, options);
    const parts = actual.renderPaperclipWakePromptParts(value, options);
    const joined = actual.joinPaperclipPromptParts(parts);
    if (joined !== text) {
      throw new Error(
        `wake prompt parts don't join to the rendered text\n--- rendered\n${text}\n--- joined\n${joined}`,
      );
    }
    const ids = parts.map((part) => part.id);
    if (new Set(ids).size !== ids.length) throw new Error(`duplicate wake part ids: ${ids.join(", ")}`);
    wakePromptPartsChecks.count += 1;
    return text;
  };
}
