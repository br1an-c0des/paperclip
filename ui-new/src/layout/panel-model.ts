/*
 * Where the shell puts a docked panel (Shell.tsx, Panel.tsx), kept apart so it can be tested.
 */

/**
 * The narrowest main content, before the panel takes its column, that holds the list and a docked
 * panel side by side: the panel's 620px, the gap, and a list of about 360px. Narrower, the panel
 * lies over the list's right edge instead. The dock's own column switches at the same width
 * (Panel.css).
 */
export const DOCK_BESIDE_MIN = 1000;

/** Main's padding on the left, and with the nav hidden, and on the right (Shell.css). */
const MAIN_PAD_START = 4;
const MAIN_PAD_START_BARE = 52;
const MAIN_PAD_END = 20;

/**
 * Whether a docked panel takes its own column beside main (true) or lies over main's right edge
 * (false), from the shell's width and the nav column's (left out while the nav is hidden).
 */
export function dockBeside(shellWidth: number, navColumn: number, navHidden: boolean): boolean {
  const content = navHidden ? shellWidth - MAIN_PAD_START_BARE - MAIN_PAD_END : shellWidth - navColumn - MAIN_PAD_START - MAIN_PAD_END;
  return content >= DOCK_BESIDE_MIN;
}
