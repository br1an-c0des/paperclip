/*
 * Showing a workspace HTML file rendered, and a CSV file as a table, after the old file viewer
 * (ui/src/lib/html-preview.ts, csv-preview.ts).
 *
 * An HTML file is untrusted: it's never put into ui-new's own page. It goes into a frame with
 * `sandbox="allow-scripts"` and no `allow-same-origin`, so it runs in an opaque origin without
 * ui-new's cookies, storage or DOM, under a Content-Security-Policy installed before any of its
 * markup is parsed. The policy lets self-contained reports and charts run their inline scripts and
 * styles, and use data: images, fonts and media; it blocks network requests, external scripts,
 * frames, embeds, forms and base URLs. A second policy in the file can only narrow the first.
 */

export const HTML_PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
  "media-src data:",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

/** The frame's document: the policy first, then the file's markup. */
export function htmlPreviewDocument(html: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${HTML_PREVIEW_CSP}"><meta name="referrer" content="no-referrer"></head><body>${html}</body></html>`;
}

/** Comma-separated records, with quoted fields that hold commas, newlines and doubled quotes. */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^﻿/, "");
  if (!source) return [];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') {
      if (quoted && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (quoted || field === "") quoted = !quoted;
      else field += char;
    } else if (!quoted && char === ",") {
      row.push(field);
      field = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      if (char === "\r" && source[index + 1] === "\n") index += 1;
    } else field += char;
  }
  if (quoted) throw new Error("A quoted field isn't closed. Switch to the source to look at the file.");
  if (field !== "" || row.length > 0 || !/[\r\n]$/.test(source)) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export const CSV_MAX_ROWS = 500;
export const CSV_MAX_COLUMNS = 100;

export type CsvTable = { header: string[]; rows: string[][]; rowCount: number; columnCount: number; clipped: boolean };

/** A CSV file as a table: its first record as the header, capped at 500 rows and 100 columns. */
export function csvTable(text: string): CsvTable | { error: string } {
  let records: string[][];
  try {
    records = parseCsv(text);
  } catch (error) {
    return { error: (error as Error).message };
  }
  const [first = [], ...rest] = records;
  const columnCount = records.reduce((count, record) => Math.max(count, record.length), 0);
  const columns = Math.min(columnCount, CSV_MAX_COLUMNS);
  const pad = (record: string[]) => Array.from({ length: columns }, (_, index) => record[index] ?? "");
  return {
    header: pad(first).map((name, index) => name || `Column ${index + 1}`),
    rows: rest.slice(0, CSV_MAX_ROWS).map(pad),
    rowCount: rest.length,
    columnCount,
    clipped: rest.length > CSV_MAX_ROWS || columnCount > CSV_MAX_COLUMNS,
  };
}
