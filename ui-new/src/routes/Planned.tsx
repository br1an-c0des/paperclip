import { type JSX } from "solid-js";
import "./Planned.css";

/*
 * A note for parts of a page that a later milestone builds, so moving around the app works and
 * old-UI links keep resolving meanwhile. Company settings, the first page built this way, are now
 * src/settings/company/.
 */

export function PlannedNote(props: { milestone: string; children: JSX.Element }) {
  return (
    <section class="card planned">
      <p class="cap">Arrives in {props.milestone}</p>
      <p>{props.children}</p>
    </section>
  );
}
