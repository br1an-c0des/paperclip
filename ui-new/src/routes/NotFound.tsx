import { A } from "@solidjs/router";
import { buttonClass } from "@/ui/Button";
import { Splash } from "./Splash";

export function NotFound() {
  return (
    <Splash
      title="Page not found"
      actions={
        <A class={buttonClass({ variant: "primary", size: "compact" })} href="/">
          Go home
        </A>
      }
    >
      Nothing lives at this address.
    </Splash>
  );
}

/** A company page this UI doesn't have yet. Old-UI links keep resolving to something sensible. */
export function NotBuiltYet() {
  return (
    <section class="card" style={{ padding: "18px 22px", display: "flex", "flex-direction": "column", gap: "6px" }}>
      <h1 class="disp" style={{ "font-size": "22px", "font-weight": 800 }}>
        Not built yet
      </h1>
      <p style={{ color: "var(--body)" }}>This page is planned for a later milestone. The classic UI still has it.</p>
    </section>
  );
}
