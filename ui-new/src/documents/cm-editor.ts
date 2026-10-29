import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { defineLanguageFacet, Language, languageDataProp } from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { EditorState, Prec } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, keymap, placeholder as placeholderText, type Command } from "@codemirror/view";
import { GFM, parser as markdownParser } from "@lezer/markdown";
import { activeMention, type ActiveMention } from "@/tasks/composer/mentions";
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
 *
 * Two hooks for the Solid side (MarkdownEditor.tsx): `onMention` reports the "@query" being typed
 * and where it is on screen, and `mentionKey` gets first go at the arrow keys, Enter, Tab and
 * Escape while the mention list is open; `onFiles` gets images pasted or dropped in, with where
 * they went, so they can be uploaded and linked.
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
  /** Replaces a range (or inserts at the cursor) and puts the cursor after the new text. */
  replace: (text: string, from?: number, to?: number) => void;
  /** Replaces the first copy of `find` with `text`, wherever editing has moved it. */
  replaceText: (find: string, text: string) => boolean;
  destroy: () => void;
};

/** The "@query" before the cursor, in document positions, with the screen point under its "@". */
export type EditorMention = ActiveMention & { left: number; bottom: number };

export type MentionKey = "up" | "down" | "pick" | "close";

/** A Markdown source editor. Ctrl/Cmd+S and Ctrl/Cmd+Enter save; Escape is left to the caller. */
export function createMarkdownEditor(
  parent: HTMLElement,
  options: {
    value: string;
    label: string;
    placeholder?: string;
    onChange: (value: string) => void;
    onSave?: () => void;
    onMention?: (mention: EditorMention | null) => void;
    /** True when the key was used by the open mention list. */
    mentionKey?: (key: MentionKey) => boolean;
    onFiles?: (files: File[], at: number) => void;
  },
): MarkdownEditorHandle {
  const save = () => {
    options.onSave?.();
    return true;
  };
  const mentionAt = (state: EditorState): ActiveMention | null => {
    const range = state.selection.main;
    if (!range.empty) return null;
    const line = state.doc.lineAt(range.head);
    const found = activeMention(line.text, range.head - line.from);
    return found ? { start: line.from + found.start, end: line.from + found.end, query: found.query } : null;
  };
  const reportMention = (target: EditorView) => {
    if (!options.onMention) return;
    const found = mentionAt(target.state);
    if (!found) {
      options.onMention(null);
      return;
    }
    // Layout can't be read during an update, so the caret's position waits for CodeMirror's measure pass.
    target.requestMeasure({
      key: "mention",
      read: (measured) => measured.coordsAtPos(found.start),
      write: (point) => options.onMention?.(point ? { ...found, left: point.left, bottom: point.bottom } : null),
    });
  };
  const key = (which: MentionKey): Command => () => options.mentionKey?.(which) ?? false;
  const images = (list: FileList | null | undefined) => [...(list ?? [])].filter((file) => file.type.startsWith("image/"));

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
        Prec.highest(
          keymap.of([
            { key: "ArrowDown", run: key("down") },
            { key: "ArrowUp", run: key("up") },
            { key: "Enter", run: key("pick") },
            { key: "Tab", run: key("pick") },
            { key: "Escape", run: key("close") },
          ]),
        ),
        EditorView.domEventHandlers({
          paste: (event, target) => {
            const files = images(event.clipboardData?.files);
            if (files.length === 0 || !options.onFiles) return false;
            event.preventDefault();
            options.onFiles(files, target.state.selection.main.head);
            return true;
          },
          drop: (event, target) => {
            const files = images(event.dataTransfer?.files);
            if (files.length === 0 || !options.onFiles) return false;
            event.preventDefault();
            const at = target.posAtCoords({ x: event.clientX, y: event.clientY }) ?? target.state.selection.main.head;
            options.onFiles(files, at);
            return true;
          },
          blur: () => {
            options.onMention?.(null);
            return false;
          },
        }),
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
          if (update.docChanged || update.selectionSet) reportMention(update.view);
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
    replace: (text, from, to) => {
      const start = from ?? view.state.selection.main.from;
      const end = to ?? (from === undefined ? view.state.selection.main.to : start);
      view.dispatch({ changes: { from: start, to: end, insert: text }, selection: { anchor: start + text.length }, scrollIntoView: true, userEvent: "input" });
      view.focus();
    },
    replaceText: (find, text) => {
      const at = view.state.doc.toString().indexOf(find);
      if (at === -1) return false;
      view.dispatch({ changes: { from: at, to: at + find.length, insert: text }, userEvent: "input" });
      return true;
    },
    destroy: () => view.destroy(),
  };
}
