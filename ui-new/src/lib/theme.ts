import { createSignal } from "solid-js";

/*
 * Light and dark are the two themes (design-system.md, "One interface, no switches"). Dark is the
 * default. You can also follow the system (the phone's You sheet offers Light, Dark and System,
 * design/mobile.md); `theme()` is always the theme actually drawn. The choice is kept per browser.
 *
 * The theme class goes on <html> together with `f-hanken`, so every portalled layer gets the same
 * tokens as the page. A subtree can use the other theme with <ThemeScope> (see ui/ThemeScope.tsx).
 */

export type Theme = "dark" | "light";
export type ThemePreference = Theme | "system";

const STORAGE_KEY = "paperclip.ui-new.theme";
const SYSTEM_DARK = "(prefers-color-scheme: dark)";

function readStoredPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "system" ? stored : "dark";
  } catch {
    return "dark";
  }
}

function readSystemTheme(): Theme {
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia(SYSTEM_DARK).matches ? "dark" : "light";
}

const [themePreference, setPreferenceSignal] = createSignal<ThemePreference>(readStoredPreference());
const [systemTheme, setSystemTheme] = createSignal<Theme>(readSystemTheme());

/** What you picked: light, dark or system. */
export { themePreference };

/** The theme drawn now. */
export function theme(): Theme {
  const preference = themePreference();
  return preference === "system" ? systemTheme() : preference;
}

function apply(next: Theme) {
  const root = document.documentElement;
  root.classList.remove("dark", "light");
  root.classList.add(next, "f-hanken");
}

export function setTheme(next: ThemePreference) {
  setPreferenceSignal(next);
  apply(theme());
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Storage can be unavailable (private windows); the choice then lasts for this page only.
  }
}

/** Switches to the other theme, leaving "system" for an explicit choice. */
export function toggleTheme() {
  setTheme(theme() === "dark" ? "light" : "dark");
}

/** Applies the stored theme and follows system changes. Call once before the first render. */
export function initTheme() {
  apply(theme());
  if (typeof window === "undefined" || !window.matchMedia) return;
  window.matchMedia(SYSTEM_DARK).addEventListener("change", (event) => {
    setSystemTheme(event.matches ? "dark" : "light");
    if (themePreference() === "system") apply(theme());
  });
}
