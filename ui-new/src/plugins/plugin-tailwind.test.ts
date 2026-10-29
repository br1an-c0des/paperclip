import { describe, expect, it } from "vitest";
import { compilePluginTailwind, extractCustomVariants, extractThemeBlocks, pluginTailwindInput } from "../../scripts/plugin-tailwind";

const OLD_INDEX = `
@import "tailwindcss";
@custom-variant dark (&:is(.dark *));
@theme inline {
  --color-background: var(--background);
  --color-muted-foreground: var(--muted-foreground);
  --radius-lg: var(--radius);
}
@theme {
  --font-mono: ui-monospace, monospace;
}
:root { --background: white; }
`;

describe("plugin compatibility stylesheet", () => {
  it("reads the old UI's theme blocks and variants", () => {
    expect(extractThemeBlocks(OLD_INDEX)).toContain("--color-background: var(--background);");
    expect(extractThemeBlocks(OLD_INDEX)).toContain("--font-mono: ui-monospace");
    expect(extractThemeBlocks(OLD_INDEX)).not.toContain(":root");
    expect(extractCustomVariants(OLD_INDEX)).toEqual(["@custom-variant dark (&:is(.dark *));"]);
    expect(pluginTailwindInput(OLD_INDEX)).not.toContain("preflight");
  });

  it("scopes every utility to plugin areas, with no preflight and no theme variables", async () => {
    const css = await compilePluginTailwind(
      ["fixed", "inset-0", "z-50", "flex", "bg-black/40", "bg-background", "text-muted-foreground", "rounded-lg", "p-4", "dark:bg-background", "md:grid-cols-2", "font-mono"],
      { oldIndexCss: OLD_INDEX, base: import.meta.dirname, minify: false },
    );
    // Scoped rules, the old UI's colours as its shadcn variables.
    expect(css).toMatch(/\.plugin-area \.fixed\s*\{\s*position: fixed/);
    expect(css).toMatch(/\.plugin-area \.bg-background\s*\{\s*background-color: var\(--background\)/);
    expect(css).toMatch(/\.plugin-area \.text-muted-foreground\s*\{\s*color: var\(--muted-foreground\)/);
    expect(css).toMatch(/\.plugin-area \.rounded-lg\s*\{\s*border-radius: var\(--radius\)/);
    expect(css).toContain(".plugin-area .dark\\:bg-background:is(.dark *)");
    // ui-new's own mono font, not the old stack.
    expect(css).toMatch(/\.plugin-area \.font-mono\s*\{\s*font-family: var\(--pc-font-mono\)/);
    // No preflight and no global theme variables that could clash with ui-new's tokens.
    expect(css).not.toMatch(/(^|\})\s*(html|body|button|\*)[\s,{]/);
    expect(css).not.toContain(":root");
    expect(css).not.toMatch(/--color-[a-z]/);
    // Every style rule outside @property/@layer properties carries the scope.
    const selectors = [...css.matchAll(/^([^@{}\n][^{}\n]*)\{/gm)].map((match) => match[1]!.trim());
    for (const selector of selectors) {
      if (selector.startsWith("*") || selector.startsWith(":before")) continue; // the @layer properties fallback
      expect(selector).toContain(".plugin-area");
    }
  });
});
