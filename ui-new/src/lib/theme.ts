import { createSignal } from "solid-js";

/*
 * Light and dark are the only user-facing theme choice (design-system.md, "One interface, no
 * switches"). Dark is the default. The choice is kept per browser.
 *
 * The theme class goes on <html> together with `f-hanken`, so every portalled layer gets the same
 * tokens as the page. A subtree can use the other theme with <ThemeScope> (see ui/ThemeScope.tsx).
 */

export type Theme = "dark" | "light";

const STORAGE_KEY = "paperclip.ui-new.theme";

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

const [theme, setThemeSignal] = createSignal<Theme>(readStoredTheme());

export { theme };

function apply(next: Theme) {
  const root = document.documentElement;
  root.classList.remove("dark", "light");
  root.classList.add(next, "f-hanken");
}

export function setTheme(next: Theme) {
  setThemeSignal(next);
  apply(next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Storage can be unavailable (private windows); the choice then lasts for this page only.
  }
}

export function toggleTheme() {
  setTheme(theme() === "dark" ? "light" : "dark");
}

/** Applies the stored theme. Call once before the first render to avoid a flash. */
export function initTheme() {
  apply(theme());
}
