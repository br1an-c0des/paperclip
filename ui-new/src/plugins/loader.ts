import type { PluginUiContribution } from "@/api/plugins";
import { opensComponent } from "./model";

/*
 * The plugin module loader and component registry, with the old UI's contract
 * (ui/src/plugins/slots.tsx, PLUGIN_SPEC.md §19.0.2–19.0.3):
 *
 * - A plugin's UI is one ES module at `/_plugins/:pluginId/ui/:uiEntryFile`, built with `react`,
 *   `react-dom`, `react/jsx-runtime` and `@paperclipai/plugin-sdk/ui` left external.
 * - The host fetches the source, points those bare imports at small blob modules that re-export
 *   the host's copies from `globalThis.__paperclipPluginBridge__` (set up by react/runtime.ts),
 *   and imports the result from a blob URL.
 * - Every exported function is registered as a React component, every exported string as a custom
 *   element tag, under `<pluginKey>:<exportName>`, which is what slots and launchers name.
 *
 * Nothing here imports React: the bridge global carries it, so this file costs nothing on pages
 * without plugin areas. Callers load the React runtime (runtime.ts) before loading a module.
 */

export type RegisteredPluginComponent = { kind: "react"; component: unknown } | { kind: "web-component"; tagName: string };

export type PluginBridgeRegistry = {
  react: Record<string, unknown>;
  reactJsxRuntime: Record<string, unknown>;
  reactDom: Record<string, unknown>;
  reactDomClient: Record<string, unknown>;
  sdkUi: Record<string, unknown>;
};

declare global {
  // eslint-disable-next-line no-var
  var __paperclipPluginBridge__: PluginBridgeRegistry | undefined;
}

const registry = new Map<string, RegisteredPluginComponent>();
const listeners = new Set<() => void>();

type LoadState = { status: "loading" } | { status: "loaded" } | { status: "error"; message: string };
const loadStates = new Map<string, LoadState>();
const inflight = new Map<string, Promise<void>>();

const registryKey = (pluginKey: string, exportName: string) => `${pluginKey}:${exportName}`;

function notify() {
  for (const listener of [...listeners]) listener();
}

/** Called whenever a component registers or a module finishes loading (or fails). */
export function onRegistryChange(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function registerPluginReactComponent(pluginKey: string, exportName: string, component: unknown) {
  registry.set(registryKey(pluginKey, exportName), { kind: "react", component });
  notify();
}

export function registerPluginWebComponent(pluginKey: string, exportName: string, tagName: string) {
  registry.set(registryKey(pluginKey, exportName), { kind: "web-component", tagName });
  notify();
}

export function resolveRegisteredComponent(pluginKey: string, exportName: string): RegisteredPluginComponent | null {
  return registry.get(registryKey(pluginKey, exportName)) ?? null;
}

/** A contribution's module key: a new version or update loads afresh. */
export function moduleKey(contribution: Pick<PluginUiContribution, "pluginId" | "updatedAt" | "version">) {
  return `${contribution.pluginId}:${contribution.updatedAt ?? contribution.version ?? "0"}`;
}

export function moduleUrl(contribution: Pick<PluginUiContribution, "pluginId" | "updatedAt" | "version" | "uiEntryFile">) {
  const cacheHint = encodeURIComponent(contribution.updatedAt ?? contribution.version ?? "0");
  return `/_plugins/${encodeURIComponent(contribution.pluginId)}/ui/${contribution.uiEntryFile}?v=${cacheHint}`;
}

/** Where a contribution's module stands: not asked for yet, loading, loaded, or failed with a message. */
export function moduleState(contribution: Pick<PluginUiContribution, "pluginId" | "updatedAt" | "version">): LoadState | null {
  return loadStates.get(moduleKey(contribution)) ?? null;
}

// ---------------------------------------------------------------------------------------------
// Bare-specifier shims

const SDK_UI_NAMES = [
  "usePluginData",
  "usePluginAction",
  "useHostContext",
  "useHostLocation",
  "useHostNavigation",
  "usePluginStream",
  "usePluginToast",
  "copyTextToClipboard",
];

/** The SDK's shared components; a host without one throws a clear error when it renders. */
export const SDK_UI_COMPONENTS = [
  "MetricCard",
  "StatusBadge",
  "DataTable",
  "TimeseriesChart",
  "MarkdownBlock",
  "MarkdownEditor",
  "KeyValueList",
  "ActionBar",
  "LogView",
  "JsonTree",
  "Spinner",
  "ErrorBoundary",
  "FileTree",
  "IssuesList",
  "AssigneePicker",
  "ProjectPicker",
  "ManagedRoutinesList",
];

type ShimName = "react" | "react/jsx-runtime" | "react-dom" | "react-dom/client" | "sdk-ui";
const shimUrls = new Map<ShimName, string>();

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** A module that re-exports every named export of the host's React. */
export function createReactShimSource(reactModule: object): string {
  const names = Object.keys(reactModule)
    .filter((name) => name !== "default" && IDENTIFIER.test(name))
    .sort();
  return [
    "const R = globalThis.__paperclipPluginBridge__?.react;",
    'if (!R) throw new Error("Paperclip plugin React runtime is not initialized.");',
    "export default R;",
    ...names.map((name) => `export const ${name} = R.${name};`),
  ].join("\n");
}

function shimSource(name: ShimName): string {
  switch (name) {
    case "react":
      return createReactShimSource(globalThis.__paperclipPluginBridge__?.react ?? {});
    case "react/jsx-runtime":
      // The host's real jsx runtime: rebuilding jsx() on createElement loses React's
      // static-children marking, and dev React then asks for keys on every multi-child element.
      return [
        "const B = globalThis.__paperclipPluginBridge__;",
        "const J = B?.reactJsxRuntime;",
        "const R = B?.react;",
        "const withKey = (props, key) => key === undefined ? (props ?? {}) : { ...(props ?? {}), key };",
        "const fallback = (type, props, key) => R.createElement(type, withKey(props, key));",
        "export const jsx = J?.jsx ?? fallback;",
        "export const jsxs = J?.jsxs ?? fallback;",
        "export const jsxDEV = J?.jsxDEV ?? J?.jsx ?? fallback;",
        "export const Fragment = J?.Fragment ?? R.Fragment;",
      ].join("\n");
    case "react-dom":
    case "react-dom/client":
      // React 19 keeps createRoot in react-dom/client and createPortal in react-dom; offer both.
      return [
        "const B = globalThis.__paperclipPluginBridge__;",
        "const RD = { ...(B?.reactDom ?? {}), ...(B?.reactDomClient ?? {}) };",
        "export default RD;",
        "export const { createRoot, hydrateRoot, createPortal, flushSync } = RD;",
      ].join("\n");
    case "sdk-ui": {
      return [
        "const SDK = globalThis.__paperclipPluginBridge__?.sdkUi ?? {};",
        "function missing(name) { return function MissingPaperclipSdkUiComponent() { throw new Error('Paperclip plugin UI runtime is not initialized for \"' + name + '\". Ensure the host loaded the plugin bridge before rendering this UI module.'); }; }",
        `export const { ${SDK_UI_NAMES.join(", ")} } = SDK;`,
        ...SDK_UI_COMPONENTS.map((name) => `export const ${name} = SDK.${name} ?? missing("${name}");`),
      ].join("\n");
    }
  }
}

function shimUrl(name: ShimName): string {
  let url = shimUrls.get(name);
  if (!url) {
    url = URL.createObjectURL(new Blob([shimSource(name)], { type: "application/javascript" }));
    shimUrls.set(name, url);
  }
  return url;
}

const SPECIFIERS: Record<string, ShimName> = {
  react: "react",
  "react/jsx-runtime": "react/jsx-runtime",
  "react/jsx-dev-runtime": "react/jsx-runtime",
  "react-dom": "react-dom",
  "react-dom/client": "react-dom/client",
  "@paperclipai/plugin-sdk/ui": "sdk-ui",
  "@paperclipai/plugin-sdk/ui/hooks": "sdk-ui",
};

/**
 * Points a module's imports of React, ReactDOM and the SDK's UI at the host's shims. Handles
 * `import … from "x"`, `export … from "x"`, side-effect `import "x"` and dynamic `import("x")`,
 * with or without spaces (minified bundles), and leaves other strings alone.
 */
export function rewriteBareSpecifiers(source: string, resolve: (name: ShimName) => string = shimUrl): string {
  const quoted = (spec: string, quote: string) => {
    const shim = SPECIFIERS[spec];
    return shim ? `${quote}${resolve(shim)}${quote}` : null;
  };
  return source
    .replace(/(\bfrom\s*|\bimport\s*)(["'])([^"'\n]+)\2/g, (whole, lead: string, quote: string, spec: string) => {
      const target = quoted(spec, quote);
      return target ? `${lead}${target}` : whole;
    })
    .replace(/(\bimport\s*\(\s*)(["'])([^"'\n]+)\2(\s*\))/g, (whole, lead: string, quote: string, spec: string, tail: string) => {
      const target = quoted(spec, quote);
      return target ? `${lead}${target}${tail}` : whole;
    });
}

/** The module's exports worth registering: functions and strings, plus every declared name. */
export function collectRegisterableExportNames(mod: Record<string, unknown>, declared: Set<string>): Set<string> {
  const names = new Set(declared);
  for (const [name, value] of Object.entries(mod)) {
    if (name === "default") continue;
    if (typeof value === "function" || typeof value === "string") names.add(name);
  }
  return names;
}

/** Test seam: how a rewritten module is imported. */
let importModule = (url: string): Promise<Record<string, unknown>> => import(/* @vite-ignore */ url);

async function importPluginModule(url: string): Promise<Record<string, unknown>> {
  if (!globalThis.__paperclipPluginBridge__) throw new Error("The plugin runtime isn't loaded.");
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error(`Couldn't fetch the plugin's UI bundle (${response.status} ${response.statusText}).`);
  const source = await response.text();
  const blobUrl = URL.createObjectURL(new Blob([rewriteBareSpecifiers(source)], { type: "application/javascript" }));
  try {
    return await importModule(blobUrl);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

/**
 * Loads a plugin's UI module once per version and registers its exports. Never throws: a failure
 * is recorded (moduleState) and logged, and the outlets show it in place of the plugin's UI.
 */
export function loadPluginModule(contribution: PluginUiContribution): Promise<void> {
  const key = moduleKey(contribution);
  const state = loadStates.get(key);
  if (state?.status === "loaded" || state?.status === "error") return Promise.resolve();
  const running = inflight.get(key);
  if (running) return running;

  loadStates.set(key, { status: "loading" });
  const declared = new Set<string>();
  for (const slot of contribution.slots) declared.add(slot.exportName);
  for (const launcher of contribution.launchers) {
    if (launcher.exportName) declared.add(launcher.exportName);
    if (opensComponent(launcher)) declared.add(launcher.action.target);
  }

  const promise = (async () => {
    try {
      const mod = await importPluginModule(moduleUrl(contribution));
      for (const name of collectRegisterableExportNames(mod, declared)) {
        const value = mod[name];
        if (typeof value === "function") registry.set(registryKey(contribution.pluginKey, name), { kind: "react", component: value });
        else if (typeof value === "string") registry.set(registryKey(contribution.pluginKey, name), { kind: "web-component", tagName: value });
        else console.warn(`Plugin "${contribution.pluginKey}" declares "${name}", but its UI module doesn't export it as a component.`);
      }
      loadStates.set(key, { status: "loaded" });
    } catch (error) {
      loadStates.set(key, { status: "error", message: error instanceof Error ? error.message : String(error) });
      console.error(`Couldn't load the UI module of plugin "${contribution.pluginKey}"`, error);
    } finally {
      inflight.delete(key);
      notify();
    }
  })();
  inflight.set(key, promise);
  return promise;
}

/** Test helpers. @internal */
export function _resetPluginLoader(nextImport?: (url: string) => Promise<Record<string, unknown>>) {
  registry.clear();
  loadStates.clear();
  inflight.clear();
  listeners.clear();
  for (const url of shimUrls.values()) URL.revokeObjectURL?.(url);
  shimUrls.clear();
  importModule = nextImport ?? ((url) => import(/* @vite-ignore */ url));
}
