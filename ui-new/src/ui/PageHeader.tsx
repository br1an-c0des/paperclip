import { A } from "@solidjs/router";
import { ArrowRight } from "lucide-solid";
import { For, Show, type JSX, type ParentProps } from "solid-js";
import "./PageHeader.css";

/*
 * The page header card (`.ph` on boards 1–11, 16, 31): breadcrumb, display title, key numbers, an
 * aside (agent avatars), actions, and the section tabs in a --well track below a divider.
 *
 * When `titleHref` is set the whole card links there (the project or agent's dashboard), with a
 * hint pill that slides in on hover. Links, buttons and tabs inside sit above that card-wide link
 * at z-index 1 (design-system.md, "Elevation and layers").
 */

export type HeaderNumberProps = { value: JSX.Element; label: JSX.Element; tone?: "red" | "amber" | "run" };

/** "16 open": the number leads, in the display face. */
export function HeaderNumber(props: HeaderNumberProps) {
  return (
    <span class="ph-number" style={props.tone ? { color: `var(--${props.tone}-fg)` } : undefined}>
      <b class="disp">{props.value}</b> {props.label}
    </span>
  );
}

export function PageHeader(
  props: ParentProps<{
    crumbs?: JSX.Element;
    title: JSX.Element;
    /** Makes the card a link to this page, such as the project dashboard. */
    titleHref?: string;
    /** The pill shown beside the title on hover, naming where `titleHref` goes. */
    titleHint?: string;
    /** Next to the title, such as a star button. */
    titleAside?: JSX.Element;
    /** Leading visual, such as the organization's disc. */
    mark?: JSX.Element;
    /** Key numbers and a muted note: <HeaderNumber>s and text. */
    numbers?: JSX.Element;
    /** Right of the text, such as the agents on a project. */
    aside?: JSX.Element;
    actions?: JSX.Element;
    /** <Tabs>, drawn below a divider. */
    tabs?: JSX.Element;
    /** "title" for a 34px title (projects, agents); "compact" for the 26px settings header. */
    size?: "title" | "compact";
  }>,
) {
  return (
    <header class="card ph" classList={{ "ph--compact": props.size === "compact" }}>
      <Show when={props.mark}>
        <span class="ph-mark">{props.mark}</span>
      </Show>
      <div class="ph-text">
        <Show when={props.crumbs}>
          <div class="ph-crumbs">{props.crumbs}</div>
        </Show>
        <div class="ph-title-row">
          <h1 class="ph-title disp">
            <Show when={props.titleHref} fallback={props.title}>
              {(href) => (
                <A class="ph-home" href={href()} end>
                  {props.title}
                  <Show when={props.titleHint}>
                    <span class="ph-go">
                      {props.titleHint}
                      <ArrowRight size={12} stroke-width={2.2} aria-hidden="true" />
                    </span>
                  </Show>
                </A>
              )}
            </Show>
          </h1>
          {props.titleAside}
        </div>
        <Show when={props.numbers}>
          <div class="ph-numbers">{props.numbers}</div>
        </Show>
        {props.children}
      </div>
      <Show when={props.aside}>
        <div class="ph-aside">{props.aside}</div>
      </Show>
      <Show when={props.actions}>
        <div class="ph-actions">{props.actions}</div>
      </Show>
      <Show when={props.tabs}>
        <div class="ph-tabs">{props.tabs}</div>
      </Show>
    </header>
  );
}

export type TabItem = { label: JSX.Element; href: string; icon?: JSX.Element; /** Match only this exact path. */ end?: boolean };

/** Section tabs: a pill track on --well; the current tab is raised and bold (`aria-current`). */
export function Tabs(props: { label: string; items: TabItem[] }) {
  return (
    <nav class="tabs" aria-label={props.label}>
      <For each={props.items}>
        {(item) => (
          <A class="tab" href={item.href} end={item.end}>
            {item.icon}
            {item.label}
          </A>
        )}
      </For>
    </nav>
  );
}

export type RailEntry =
  | { heading: string }
  | { label: JSX.Element; href: string; /** A quiet trailing note, such as "Soon". */ tag?: JSX.Element; end?: boolean };

/**
 * The section rail settings pages use (boards 21, 26, 28): a 210px column of section links with
 * optional headings. On a narrow container it becomes a horizontal, scrolling row.
 */
export function SectionRail(props: { label: string; entries: RailEntry[] }) {
  return (
    <nav class="rail" aria-label={props.label}>
      <For each={props.entries}>
        {(entry) =>
          "heading" in entry ? (
            <h2 class="rail-head disp">{entry.heading}</h2>
          ) : (
            <A class="rail-item" href={entry.href} end={entry.end}>
              {entry.label}
              <Show when={entry.tag}>
                <span class="rail-tag">{entry.tag}</span>
              </Show>
            </A>
          )
        }
      </For>
    </nav>
  );
}

/** A rail beside its page content, as on the settings boards. */
export function RailLayout(props: ParentProps<{ rail: JSX.Element }>) {
  return (
    <div class="rail-layout">
      {props.rail}
      <div class="rail-content">{props.children}</div>
    </div>
  );
}
