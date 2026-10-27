import { afterEach, describe, expect, it } from "vitest";
import { setTheme, theme, themePreference, toggleTheme } from "./theme";

// The test setup's matchMedia answers no to `(prefers-color-scheme: dark)`, so "system" is light.

describe("theme", () => {
  afterEach(() => setTheme("dark"));

  it("follows the system when asked, and draws the system's theme", () => {
    setTheme("system");
    expect(themePreference()).toBe("system");
    expect(theme()).toBe("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(localStorage.getItem("paperclip.ui-new.theme")).toBe("system");
  });

  it("toggles to an explicit theme, away from system", () => {
    setTheme("system");
    toggleTheme();
    expect(themePreference()).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
  });
});
