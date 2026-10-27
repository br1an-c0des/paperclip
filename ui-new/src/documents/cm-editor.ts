import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { defineLanguageFacet, Language, languageDataProp } from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, keymap, placeholder as placeholderText, type Command } from "@codemirror/view";
import { GFM, parser as markdownParser } from "@lezer/markdown";
import { listContinuation } from "./document-model";
import { shared } from "./cm-theme";

/*
 * The document editor: CodeMirror 6 with GitHub-flavoured Markdown. Only ever imported dynamically
 * (MarkdownEditor.tsx), so it loads the first time someone edits a document, not with the app.
 *
 * Markdown comes straight from @lezer/markdown rather than @codemirror/lang-markdown, which pulls in
 * the HTML, CSS and JavaScript grammars for embedded code (about 70 KB gzipped). Fenced code isn't
 * highlighted in the editor as a result; Enter continues lists, which lang-markdown would otherwise
 * provide.
 */

const markdownData = defineLanguageFacet({ commentTokens: { block: { open: "<!--", close: "-->" } } });
const markdownLanguage = new Language(
  markdownData,
  markdownParser.configure([GFM, { props: [languageDataProp.add({ Document: markdownData })] }]),
  [],
  "markdown",
);

/** Enter at the end of a list item starts the next one, or ends the list on an empty item. */
const continueList: Command = (view) => {
  const range = view.state.selection.main;
  if (!range.empty) return false;
  const line = view.state.doc.lineAt(range.head);
  if (range.head !== line.to) return false;
  const next = listContinuation(line.text);
  if (!next) return false;
  if (next.kind === "end") {
    view.dispatch({ changes: { from: line.from, to: line.to, insert: "" }, userEvent: "delete" });
    return true;
  }
  view.dispatch({
    changes: { from: range.head, insert: next.insert },
    selection: { anchor: range.head + next.insert.length },
    scrollIntoView: true,
    userEvent: "input",
  });
  return true;
};

export type MarkdownEditorHandle = {
  focus: () => void;
  setValue: (value: string) => void;
  destroy: () => void;
};

/** A Markdown source editor. Ctrl/Cmd+S and Ctrl/Cmd+Enter save; Escape is left to the caller. */
export function createMarkdownEditor(
  parent: HTMLElement,
  options: {
    value: string;
    label: string;
    placeholder?: string;
    onChange: (value: string) => void;
    onSave?: () => void;
  },
): MarkdownEditorHandle {
  const save = () => {
    options.onSave?.();
    return true;
  };
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: options.value,
      extensions: [
        shared,
        history(),
        drawSelection(),
        highlightActiveLine(),
        search({ top: true }),
        highlightSelectionMatches(),
        markdownLanguage.extension,
        keymap.of([
          { key: "Mod-s", run: save, preventDefault: true },
          { key: "Mod-Enter", run: save },
          { key: "Enter", run: continueList },
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          indentWithTab,
        ]),
        placeholderText(options.placeholder ?? ""),
        EditorView.contentAttributes.of({ "aria-label": options.label, "aria-multiline": "true" }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) options.onChange(update.state.doc.toString());
        }),
      ],
    }),
  });
  return {
    focus: () => view.focus(),
    setValue: (value) => {
      if (value === view.state.doc.toString()) return;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    },
    destroy: () => view.destroy(),
  };
}
