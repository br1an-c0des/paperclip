import { createContext, useContext, type JSX, type ParentProps } from "solid-js";
import { isCompact } from "@/layout/breakpoints";
import "./layer.css";

/*
 * Shared behaviour for everything that floats over the page: menus, popovers and dialogs.
 *
 * - Where layers mount. Portals go to the nearest <ThemeScope> (or <body>), so a layer opened from a
 *   light subtree is drawn light.
 * - How layers are drawn. On a phone-sized viewport an anchored layer becomes a bottom sheet and a
 *   dialog a full-screen sheet. `layerMode()` is the one place that decides it; the wrappers in
 *   Popover.tsx, Menu.tsx and Dialog.tsx read it, and layer.css draws each mode.
 */

export type LayerMode = "anchored" | "sheet";

export function layerMode(): LayerMode {
  return isCompact() ? "sheet" : "anchored";
}

const LayerMountContext = createContext<() => HTMLElement | undefined>(() => undefined);

export function LayerMountProvider(props: ParentProps<{ mount: () => HTMLElement | undefined }>) {
  return <LayerMountContext.Provider value={props.mount}>{props.children}</LayerMountContext.Provider>;
}

/** The element portals should mount into, or undefined for <body>. */
export function useLayerMount() {
  return useContext(LayerMountContext);
}

/** Children that only make sense in one mode, such as a sheet's drag handle. */
export function SheetOnly(props: ParentProps): JSX.Element {
  return <>{layerMode() === "sheet" ? props.children : null}</>;
}
