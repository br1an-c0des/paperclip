import type { PluginHostContext } from "@paperclipai/plugin-sdk/ui";
import * as React from "react";
import { Component, createElement as h, type ErrorInfo, type ReactNode } from "react";
import * as ReactDom from "react-dom";
import * as ReactDomClient from "react-dom/client";
import * as ReactJsxRuntime from "react/jsx-runtime";
import { PluginBridgeContext, copyTextToClipboard, useHostContext, useHostLocation, useHostNavigation, usePluginAction, usePluginData, usePluginStream, usePluginToast } from "./bridge";
import { discGradient, initials } from "@/ui/Avatar";
import * as components from "./components";
import "./sdk.css";
// The old UI's Tailwind classes, scoped to plugin areas (scripts/plugin-tailwind.ts, decision 39 D10).
import "virtual:paperclip-plugin-tailwind.css";

/*
 * The React side of plugin hosting, loaded with a dynamic import (../runtime.ts) the first time a
 * page has a plugin area, so pages without one never download React.
 *
 * Loading it sets up `globalThis.__paperclipPluginBridge__` as the old UI's bridge-init.ts does: the
 * host's React, ReactDOM and jsx runtime, and the SDK's hooks and shared components, which the
 * module loader (../loader.ts) hands to plugin bundles. `mountPluginComponent` renders one plugin
 * component into a host element as its own React root, inside an error boundary and the bridge
 * context its hooks read.
 */

globalThis.__paperclipPluginBridge__ = {
  react: React as unknown as Record<string, unknown>,
  reactJsxRuntime: ReactJsxRuntime as unknown as Record<string, unknown>,
  reactDom: ReactDom as unknown as Record<string, unknown>,
  reactDomClient: ReactDomClient as unknown as Record<string, unknown>,
  sdkUi: {
    usePluginData,
    usePluginAction,
    useHostContext,
    useHostLocation,
    useHostNavigation,
    usePluginStream,
    usePluginToast,
    copyTextToClipboard,
    ...components,
  },
};

export type MountSpec = {
  pluginId: string;
  /** Named in the error fallback: "<label>: failed to render". */
  label: string;
  /** The plugin's exported component (a function or class). */
  component: unknown;
  props: Record<string, unknown>;
  hostContext: PluginHostContext;
  /** Called when the component throws; a replacement surface uses it to fall back to the host's own. */
  onError?: () => void;
};

export type MountHandle = { update: (spec: MountSpec) => void; unmount: () => void };

type BoundaryProps = { label: string; pluginId: string; onError?: () => void; children?: ReactNode };

/** One plugin area failing leaves the page and every other plugin area standing. */
export class PluginErrorBoundary extends Component<BoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("Plugin UI failed to render", { pluginId: this.props.pluginId, label: this.props.label, error, componentStack: info.componentStack });
    this.props.onError?.();
  }

  override render() {
    if (this.state.failed) return h("div", { className: "plugin-error", role: "alert" }, `${this.props.label}: failed to render`);
    return this.props.children;
  }
}

function tree(spec: MountSpec) {
  return h(
    PluginErrorBoundary,
    { label: spec.label, pluginId: spec.pluginId, onError: spec.onError },
    h(PluginBridgeContext.Provider, { value: { pluginId: spec.pluginId, hostContext: spec.hostContext } }, h(spec.component as React.ComponentType<Record<string, unknown>>, spec.props)),
  );
}

export function mountPluginComponent(container: HTMLElement, spec: MountSpec): MountHandle {
  const root = ReactDomClient.createRoot(container);
  root.render(tree(spec));
  return {
    update: (next) => root.render(tree(next)),
    // Unmounting inside a Solid cleanup can land mid-render; defer it a tick as React asks.
    unmount: () => queueMicrotask(() => root.unmount()),
  };
}

/**
 * A company's mark as a React element, for the `organizationSwitcher` slot's `renderIcon`: the logo,
 * or the initials disc ui-new's switcher draws (ui/Avatar.tsx's colours, keyed by `seed`).
 */
export function renderCompanyIcon(name: string, logoUrl: string | null, inMenu: boolean, seed: string) {
  const size = inMenu ? 22 : 28;
  if (logoUrl) {
    return h("img", { src: logoUrl, alt: "", width: size, height: size, className: "plugin-company-logo", style: { width: size, height: size } });
  }
  return h(
    "span",
    {
      className: "disc-avatar",
      "aria-hidden": "true",
      style: { width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.36)), background: discGradient(seed) },
    },
    initials(name),
  );
}
