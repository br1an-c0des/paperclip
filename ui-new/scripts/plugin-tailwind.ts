/*
 * The plugin compatibility stylesheet (decision 39, D10). Plugins written for the old UI style
 * themselves with its Tailwind classes (`fixed inset-0 z-50 flex …`, `text-muted-foreground`);
 * ui-new has no Tailwind, so those plugins rendered unstyled. This generates, at build time, the
 * same utilities the old UI offers: the classes found in the old UI's sources and the first-party
 * plugins (the old UI doesn't scan third-party plugins either), compiled against the old UI's theme.
 *
 * - Every rule is scoped to `.plugin-area`, so nothing outside plugin areas changes. The scope also
 *   lifts each utility above ui-new's element rules (`button`, `a`…) in base.css.
 * - No preflight: ui-new's base.css already resets the page, and preflight would restyle ui-new.
 * - The theme is inlined (`theme(inline)`), so no `--color-*`, `--text-*` or `--shadow-*` variables
 *   are declared that could clash with ui-new's tokens. The old UI's colour utilities resolve to its
 *   shadcn variables (`var(--border)`…), which plugins.css points at ui-new's tokens inside plugin
 *   areas.
 * - Loaded lazily with the plugin runtime (src/plugins/react/runtime.ts imports the virtual module),
 *   so pages without a plugin area never download it.
 *
 * Tailwind is a build-time devDependency of ui-new for this sheet only.
 */
import fs from "fs";
import path from "path";
import type { Plugin } from "vite";

export const PLUGIN_TAILWIND_ID = "virtual:paperclip-plugin-tailwind.css";
export const PLUGIN_AREA_SELECTOR = ".plugin-area";

const repoRoot = path.resolve(import.meta.dirname, "../..");

/** Where the old UI finds its classes, plus the first-party plugins. */
export const PLUGIN_TAILWIND_SOURCES = [
  { base: path.join(repoRoot, "ui/src"), pattern: "**/*" },
  { base: path.join(repoRoot, "ui"), pattern: "index.html" },
  { base: path.join(repoRoot, "packages/plugins"), pattern: "**/src/**/*" },
];

/** The bodies of every `@theme` block in a stylesheet, joined. */
export function extractThemeBlocks(source: string): string {
  // Comments mention `@theme` too ("Kept in :root (NOT @theme inline)…").
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const bodies: string[] = [];
  const opener = /^@theme\b[^{;]*\{/gm;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(css))) {
    let depth = 1;
    let index = opener.lastIndex;
    while (index < css.length && depth > 0) {
      if (css[index] === "{") depth++;
      else if (css[index] === "}") depth--;
      index++;
    }
    bodies.push(css.slice(opener.lastIndex, index - 1));
    opener.lastIndex = index;
  }
  return bodies.join("\n");
}

/** The old UI's custom variants (`@custom-variant dark (&:is(.dark *));`), one per line. */
export function extractCustomVariants(css: string): string[] {
  return css.match(/^@custom-variant[^;]*;/gm) ?? [];
}

/**
 * The Tailwind input: the default theme inlined, the old UI's `@theme` blocks (inlined too), a few
 * overrides that point the old fonts at ui-new's, and the utilities nested under the scope.
 */
export function pluginTailwindInput(oldIndexCss: string, scope = PLUGIN_AREA_SELECTOR): string {
  return [
    `@import "tailwindcss/theme.css" theme(inline);`,
    ...extractCustomVariants(oldIndexCss),
    `@theme inline {`,
    extractThemeBlocks(oldIndexCss),
    // ui-new doesn't load the old UI's Inter; plugin text takes ui-new's fonts instead. The mono font
    // goes through another name: Tailwind declares any theme variable a utility reads on `:root`,
    // and `--font-mono: var(--font-mono)` there would break ui-new's own token.
    `  --font-sans: var(--font-ui);`,
    `  --font-heading: var(--font-ui);`,
    `  --font-mono: var(--pc-font-mono);`,
    `}`,
    // Arbitrary values written against the old theme (`p-[calc(var(--spacing)*3)]`) still resolve.
    `${scope} { --spacing: 0.25rem; --pc-font-mono: var(--font-mono); @tailwind utilities; }`,
  ].join("\n");
}

/** Compiles the given class candidates against the old UI's theme, scoped and minified. */
export async function compilePluginTailwind(candidates: string[], options: { oldIndexCss: string; base: string; minify?: boolean }) {
  const { compile, optimize } = await import("@tailwindcss/node");
  const compiler = await compile(pluginTailwindInput(options.oldIndexCss), { base: options.base, onDependency() {} });
  // Tailwind still declares a few theme variables on `:root, :host` (the font stacks preflight would
  // read). Everything is inlined, so they're only a risk to ui-new's tokens: drop them.
  const css = compiler.build(candidates).replace(/:root,\s*:host\s*\{[^{}]*\}/g, "");
  return optimize(css, { minify: options.minify ?? true }).code;
}

/** Scans the old UI and the first-party plugins for class candidates. */
export async function scanPluginTailwindCandidates(): Promise<string[]> {
  const { Scanner } = await import("@tailwindcss/oxide");
  const sources = PLUGIN_TAILWIND_SOURCES.filter((source) => fs.existsSync(source.base)).map((source) => ({ ...source, negated: false }));
  return new Scanner({ sources }).scan();
}

export async function generatePluginTailwind(minify = true): Promise<string> {
  const oldIndexCss = path.join(repoRoot, "ui/src/index.css");
  if (!fs.existsSync(oldIndexCss)) return "";
  const candidates = await scanPluginTailwindCandidates();
  return compilePluginTailwind(candidates, { oldIndexCss: fs.readFileSync(oldIndexCss, "utf8"), base: import.meta.dirname, minify });
}

/** Serves the sheet as a virtual CSS module, generated once per dev server or build. */
export function pluginTailwind(): Plugin {
  // A path ending in .css, so Vite's CSS pipeline (and code splitting) handles it like a file.
  let resolvedId = "";
  let sheet: Promise<string> | null = null;
  return {
    name: "paperclip-plugin-tailwind",
    configResolved(config) {
      resolvedId = path.join(config.root, "__plugin-tailwind.css");
    },
    resolveId(id) {
      if (id === PLUGIN_TAILWIND_ID) return resolvedId;
    },
    load(id) {
      if (id !== resolvedId) return;
      // Tests never render plugin styles; skip the scan there.
      if (process.env.VITEST) return "";
      sheet ??= generatePluginTailwind(false);
      return sheet;
    },
  };
}
