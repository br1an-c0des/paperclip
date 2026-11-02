import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { indentUnit, LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { shared } from "@/documents/cm-theme";

/*
 * The agent YAML editor: CodeMirror 6 with line numbers, two-space indents and YAML highlighting
 * (the language pack loads on demand through @codemirror/language-data). Only ever imported
 * dynamically (AdvancedSection.tsx). Ctrl/Cmd+S saves.
 */

export type YamlEditorHandle = {
  setValue: (value: string) => void;
  setReadOnly: (readOnly: boolean) => void;
  destroy: () => void;
};

export function createYamlEditor(
  parent: HTMLElement,
  options: { value: string; label: string; readOnly: boolean; onChange: (value: string) => void; onSave: () => void },
): YamlEditorHandle {
  const language = new Compartment();
  const editable = new Compartment();
  const editability = (readOnly: boolean) => [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: options.value,
      extensions: [
        shared,
        lineNumbers(),
        highlightActiveLineGutter(),
        history(),
        drawSelection(),
        highlightActiveLine(),
        search({ top: true }),
        highlightSelectionMatches(),
        indentUnit.of("  "),
        EditorState.tabSize.of(2),
        Prec.highest(
          keymap.of([
            { key: "Mod-s", preventDefault: true, run: () => (options.onSave(), true) },
          ]),
        ),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        language.of([]),
        editable.of(editability(options.readOnly)),
        EditorView.contentAttributes.of({ "aria-label": options.label, spellcheck: "false", autocapitalize: "off", autocorrect: "off" }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) options.onChange(update.state.doc.toString());
        }),
      ],
    }),
  });
  let destroyed = false;
  const description = LanguageDescription.matchFilename(languages, "agent.yaml");
  if (description) {
    void description.load().then((support) => {
      if (!destroyed) view.dispatch({ effects: language.reconfigure(support) });
    });
  }
  return {
    setValue: (value) => {
      if (view.state.doc.toString() !== value) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    },
    setReadOnly: (readOnly) => view.dispatch({ effects: editable.reconfigure(editability(readOnly)) }),
    destroy: () => {
      destroyed = true;
      view.destroy();
    },
  };
}
