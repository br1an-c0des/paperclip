import { useLocation } from "@solidjs/router";
import { Menu as MenuIcon, X } from "lucide-solid";
import { createContext, createEffect, createSignal, on, Show, useContext, type JSX, type ParentProps } from "solid-js";
import { isCompact } from "./breakpoints";
import "./Shell.css";

/*
 * The app shell: a grid with named areas, nav and main, with the side panel laid over main's
 * right edge (boards 2, 3 and 5). Nothing in it has a fixed page width; the 248px nav column is
 * the only fixed track, and main is `minmax(0, 1fr)`.
 *
 * On a phone-sized viewport the grid drops to one column: the nav becomes a drawer opened from a
 * top bar, and the panel becomes a full-screen sheet. That switch lives in Shell.css under
 * `:root[data-viewport="phone"]`; components inside the shell don't change.
 *
 * `main` is a size container named `main`, so content responds to the space it's given with
 * `@container main (...)`, not to the viewport.
 */

type ShellContextValue = {
  panelHost: () => HTMLElement | undefined;
  closeNav: () => void;
};

const ShellContext = createContext<ShellContextValue>();

/** The surrounding shell, or undefined outside one (the style guide). */
export function useShell() {
  return useContext(ShellContext);
}

export function Shell(
  props: ParentProps<{
    nav: JSX.Element;
    /** Shown in the phone top bar, beside the menu button. */
    title?: JSX.Element;
  }>,
) {
  const [panelHost, setPanelHost] = createSignal<HTMLElement>();
  const [navOpen, setNavOpen] = createSignal(false);
  const location = useLocation();

  // Following a link in the drawer closes it.
  createEffect(on(() => location.pathname, () => setNavOpen(false), { defer: true }));
  // Leaving the phone layout closes it too, so it isn't open when the viewport shrinks again.
  createEffect(() => {
    if (!isCompact()) setNavOpen(false);
  });

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && navOpen()) setNavOpen(false);
  };

  return (
    <ShellContext.Provider value={{ panelHost, closeNav: () => setNavOpen(false) }}>
      <div class="shell" data-nav-open={navOpen() ? "" : undefined} onKeyDown={onKeyDown}>
        <header class="shell-bar">
          <button
            type="button"
            class="btn btn--icon btn--ghost"
            aria-label={navOpen() ? "Close navigation" : "Open navigation"}
            aria-expanded={navOpen()}
            aria-controls="shell-nav"
            onClick={() => setNavOpen(!navOpen())}
          >
            <Show when={navOpen()} fallback={<MenuIcon size={18} aria-hidden="true" />}>
              <X size={18} aria-hidden="true" />
            </Show>
          </button>
          <div class="shell-bar-title">{props.title}</div>
        </header>
        <Show when={navOpen()}>
          <div class="shell-nav-scrim" aria-hidden="true" onClick={() => setNavOpen(false)} />
        </Show>
        <nav id="shell-nav" class="shell-nav" aria-label="Main">
          {props.nav}
        </nav>
        <main class="shell-main">{props.children}</main>
        <div ref={setPanelHost} class="shell-panel" />
      </div>
    </ShellContext.Provider>
  );
}
