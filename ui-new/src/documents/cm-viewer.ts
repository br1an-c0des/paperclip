import { defaultKeymap } from "@codemirror/commands";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import { Decoration, drawSelection, EditorView, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { shared } from "./cm-theme";

/*
 * The file viewer's source preview: read-only CodeMirror 6 with line numbers. Only ever imported
 * dynamically (CodeView.tsx). The language pack for a file loads on demand, by file name, through
 * @codemirror/language-data.
 */

export type CodeViewHandle = { destroy: () => void };

/**
 * Read-only source with line numbers and highlighting picked by file name. `line` scrolls to that
 * line and marks it, for links that point into a file.
 */
export function createCodeView(
  parent: HTMLElement,
  options: { value: string; filename: string; label: string; line?: number | null },
): CodeViewHandle {
  const language = new Compartment();
  const target = new Compartment();
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: options.value,
      extensions: [
        shared,
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        lineNumbers(),
        highlightActiveLineGutter(),
        drawSelection(),
        search({ top: true }),
        highlightSelectionMatches(),
        keymap.of([...searchKeymap, ...defaultKeymap]),
        language.of([]),
        target.of([]),
        EditorView.contentAttributes.of({ "aria-label": options.label, tabindex: "0" }),
      ],
    }),
  });
  let destroyed = false;
  const description = LanguageDescription.matchFilename(languages, options.filename);
  if (description) {
    void description.load().then((support) => {
      if (!destroyed) view.dispatch({ effects: language.reconfigure(support) });
    });
  }
  const line = options.line;
  if (line && line >= 1 && line <= view.state.doc.lines) {
    const at = view.state.doc.line(line);
    view.dispatch({
      effects: [
        target.reconfigure(EditorView.decorations.of(Decoration.set([Decoration.line({ class: "cm-target-line" }).range(at.from)]))),
        EditorView.scrollIntoView(at.from, { y: "center" }),
      ],
    });
  }
  return {
    destroy: () => {
      destroyed = true;
      view.destroy();
    },
  };
}
