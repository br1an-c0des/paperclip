import { afterAll, describe, expect, it } from "vitest";
import { navHidden, navMode, navNarrow, recheckNavRoom, setNavHidden, setNavMode, toggleNavRailPref } from "./nav-prefs";

/*
 * The nav's fold as this browser keeps it: full or rail and hidden saved in localStorage, and the
 * window's room read through the media query (the test setup answers `min-width` from
 * `window.innerWidth`; `recheckNavRoom` reads it again, as the query's listener does live).
 */

const MODE_KEY = "paperclip.ui-new.nav-mode";
const HIDDEN_KEY = "paperclip.ui-new.nav-hidden";
const startWidth = window.innerWidth;

function resizeTo(width: number) {
  window.innerWidth = width;
  recheckNavRoom();
}

describe("the nav's fold, per browser", () => {
  afterAll(() => resizeTo(startWidth));

  it("saves full or rail, and shows the rail by itself in a narrow window until there's room", () => {
    resizeTo(1440);
    expect(navNarrow()).toBe(false);
    setNavMode("full");
    expect(navMode()).toBe("full");

    toggleNavRailPref();
    expect(navMode()).toBe("rail");
    expect(localStorage.getItem(MODE_KEY)).toBe('"rail"');
    toggleNavRailPref();
    expect(navMode()).toBe("full");

    resizeTo(1000);
    expect(navNarrow()).toBe(true);
    expect(navMode()).toBe("rail");
    // [ while narrow: the full nav for now, the saved choice untouched.
    toggleNavRailPref();
    expect(navMode()).toBe("full");
    expect(localStorage.getItem(MODE_KEY)).toBe('"full"');
    resizeTo(1440);
    expect(navMode()).toBe("full");
    resizeTo(1000);
    expect(navMode()).toBe("rail");
  });

  it("keeps a saved rail through a narrow window's switch", () => {
    resizeTo(1440);
    setNavMode("rail");
    resizeTo(1000);
    toggleNavRailPref();
    expect(navMode()).toBe("full");
    expect(localStorage.getItem(MODE_KEY)).toBe('"rail"');
    resizeTo(1440);
    expect(navMode()).toBe("rail");
  });

  it("hides and brings back the nav as it was, saving that too", () => {
    resizeTo(1440);
    setNavMode("rail");
    setNavHidden(true);
    expect(navHidden()).toBe(true);
    expect(localStorage.getItem(HIDDEN_KEY)).toBe("true");
    expect(navMode()).toBe("rail");
    // [ on a hidden nav shows it again, still the rail.
    toggleNavRailPref();
    expect(navHidden()).toBe(false);
    expect(navMode()).toBe("rail");
    expect(localStorage.getItem(HIDDEN_KEY)).toBe("false");
  });
});
