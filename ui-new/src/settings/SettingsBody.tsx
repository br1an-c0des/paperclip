import { Show, type ParentProps } from "solid-js";
import { isCompact } from "@/layout/breakpoints";
import { SectionRail } from "@/ui/PageHeader";
import "./SettingsBody.css";

/*
 * What App settings and Company settings share: the shape of their section lists, and the body that
 * holds a section.
 *
 * Each area builds its list once (settings/app/app-sections.ts, settings/company/company-sections.ts);
 * the settings sidebar (layout/SettingsNav.tsx) and the page both draw from it. On tablet and desktop
 * the sidebar carries the sections, so the section takes main's full width. On a phone the shell
 * shows the dock instead of any nav, so the page keeps its own section rail, as a scrolling row
 * above the section (design/mobile.md: settings stay on desktop, but you can look around).
 *
 * The rail is added and removed beside the section, never around it, so crossing the phone
 * breakpoint doesn't remount the section and lose what's typed in it.
 */

/** A heading, or a section's row. `key` names the section (its icon in the sidebar). */
export type SettingsEntry =
  | { heading: string }
  | { key: string; label: string; href: string; /** Raised only on this exact address (a section at the area's root). */ end?: boolean; /** A quiet trailing note: "plugin", "none". */ tag?: string };

export function SettingsBody(props: ParentProps<{ label: string; entries: SettingsEntry[] }>) {
  return (
    <div class="rail-layout settings-body" classList={{ "settings-body--wide": !isCompact() }}>
      <Show when={isCompact()}>
        <SectionRail label={props.label} entries={props.entries} />
      </Show>
      <div class="rail-content">{props.children}</div>
    </div>
  );
}
