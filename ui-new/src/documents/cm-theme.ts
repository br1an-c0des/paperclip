import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

/*
 * CodeMirror's look, shared by the document editor (cm-editor.ts) and the file viewer
 * (cm-viewer.ts). Colors come from the design tokens, so both themes work without a CodeMirror
 * theme each. Only ever imported dynamically, through those two modules.
 */

const theme = EditorView.theme({
  "&": {
    color: "var(--text)",
    backgroundColor: "transparent",
    fontSize: "13px",
    height: "100%",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "1.6",
    overflow: "auto",
  },
  ".cm-content": { padding: "12px 0", caretColor: "var(--run-fg)" },
  ".cm-line": { padding: "0 14px" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--run-fg)", borderLeftWidth: "2px" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in srgb, var(--run-fg) 28%, transparent) !important",
  },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--well) 60%, transparent)" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--muted)",
    border: "none",
    borderRight: "1px solid var(--line)",
  },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--text)" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 10px 0 12px", minWidth: "32px" },
  ".cm-placeholder": { color: "var(--muted)" },
  ".cm-line.cm-target-line": { backgroundColor: "color-mix(in srgb, var(--amber-fg) 18%, transparent)" },
  ".cm-searchMatch": { backgroundColor: "color-mix(in srgb, var(--amber-fg) 30%, transparent)" },
  ".cm-searchMatch-selected": { backgroundColor: "color-mix(in srgb, var(--amber-fg) 55%, transparent)" },
  ".cm-selectionMatch": { backgroundColor: "color-mix(in srgb, var(--run-fg) 14%, transparent)" },
  ".cm-panels": { backgroundColor: "var(--card)", color: "var(--text)", borderColor: "var(--line)" },
  ".cm-panels input, .cm-panels button": { font: "inherit", fontSize: "12px" },
  ".cm-textfield": {
    border: "1px solid var(--edge)",
    borderRadius: "8px",
    background: "var(--ground)",
    color: "var(--text)",
    padding: "2px 6px",
  },
  ".cm-button": {
    border: "1px solid var(--edge)",
    borderRadius: "999px",
    backgroundImage: "none",
    background: "var(--card)",
    color: "var(--text)",
  },
});

const highlight = HighlightStyle.define([
  { tag: [tags.heading1, tags.heading2, tags.heading3, tags.heading4, tags.heading5, tags.heading6], fontWeight: "800", color: "var(--text)" },
  { tag: tags.heading1, fontSize: "1.15em" },
  { tag: tags.strong, fontWeight: "800" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: [tags.link, tags.url], color: "var(--run-fg)" },
  { tag: [tags.monospace, tags.quote], color: "var(--body)" },
  { tag: [tags.processingInstruction, tags.contentSeparator, tags.list], color: "var(--muted)" },
  { tag: [tags.keyword, tags.modifier, tags.controlKeyword, tags.operatorKeyword], color: "var(--violet-fg)" },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: "var(--green-fg)" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "var(--amber-fg)" },
  { tag: [tags.comment, tags.meta], color: "var(--muted)", fontStyle: "italic" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "var(--run-fg)" },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "var(--cyan-fg)" },
  { tag: [tags.tagName, tags.angleBracket], color: "var(--red-fg)" },
  { tag: [tags.attributeName, tags.propertyName], color: "var(--cyan-fg)" },
  { tag: tags.invalid, color: "var(--red-fg)" },
]);

export const shared: Extension = [theme, syntaxHighlighting(highlight), EditorView.lineWrapping];
