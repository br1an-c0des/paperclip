import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginUiContribution } from "@/api/plugins";
import {
  _resetPluginLoader,
  collectRegisterableExportNames,
  createReactShimSource,
  loadPluginModule,
  moduleState,
  onRegistryChange,
  resolveRegisteredComponent,
  rewriteBareSpecifiers,
} from "./loader";

const contribution: PluginUiContribution = {
  pluginId: "p1",
  pluginKey: "acme.fixture",
  displayName: "Fixture",
  version: "1.0.0",
  updatedAt: "2026-10-28T00:00:00.000Z",
  uiEntryFile: "index.js",
  slots: [{ type: "page", id: "page", displayName: "Page", exportName: "Page", routePath: "fixture" }],
  launchers: [{ id: "l", displayName: "Open", placementZone: "toolbarButton", action: { type: "openModal", target: "Modal" } }],
};

beforeEach(() => {
  // jsdom has no blob URLs.
  URL.createObjectURL = vi.fn(() => "blob:test");
  URL.revokeObjectURL = vi.fn();
  vi.stubGlobal("__paperclipPluginBridge__", { react: { createElement: () => null, useState: () => null }, reactJsxRuntime: {}, reactDom: {}, reactDomClient: {}, sdkUi: {} });
});

afterEach(() => {
  _resetPluginLoader();
  vi.unstubAllGlobals();
});

describe("rewriteBareSpecifiers", () => {
  const resolve = (name: string) => `blob:${name}`;

  it("points React, ReactDOM and the SDK's UI at the host's shims", () => {
    const source = [
      'import React, { useState } from "react";',
      "import { jsx } from 'react/jsx-runtime';",
      'import { createRoot } from "react-dom/client";',
      'import { usePluginData } from "@paperclipai/plugin-sdk/ui";',
      'import { useHostContext } from "@paperclipai/plugin-sdk/ui/hooks";',
      'export { createPortal } from "react-dom";',
      'import "react";',
      'const lazy = import("react-dom");',
    ].join("\n");
    expect(rewriteBareSpecifiers(source, resolve as never)).toBe(
      [
        'import React, { useState } from "blob:react";',
        "import { jsx } from 'blob:react/jsx-runtime';",
        'import { createRoot } from "blob:react-dom/client";',
        'import { usePluginData } from "blob:sdk-ui";',
        'import { useHostContext } from "blob:sdk-ui";',
        'export { createPortal } from "blob:react-dom";',
        'import "blob:react";',
        'const lazy = import("blob:react-dom");',
      ].join("\n"),
    );
  });

  it("handles minified imports and leaves other modules and strings alone", () => {
    expect(rewriteBareSpecifiers('import{a as b}from"react";import{x}from"./chunk.js";const s="react";', ((name: string) => `blob:${name}`) as never)).toBe(
      'import{a as b}from"blob:react";import{x}from"./chunk.js";const s="react";',
    );
  });
});

describe("shims and exports", () => {
  it("re-exports every named export of the host's React", () => {
    const source = createReactShimSource({ default: {}, useState: 1, createElement: 2, "not-valid": 3 });
    expect(source).toContain("export default R;");
    expect(source).toContain("export const createElement = R.createElement;");
    expect(source).toContain("export const useState = R.useState;");
    expect(source).not.toContain("not-valid");
  });

  it("registers component-like exports and keeps declared names for diagnostics", () => {
    const names = collectRegisterableExportNames({ Page: () => null, tag: "x-widget", meta: { a: 1 }, count: 1, default: () => null }, new Set(["Page", "Missing"]));
    expect(names).toEqual(new Set(["Page", "Missing", "tag"]));
  });
});

describe("loadPluginModule", () => {
  it("loads a module once, registers its components and tags, and announces it", async () => {
    const Page = () => null;
    const imported = vi.fn(async () => ({ Page, Modal: () => null, widget: "x-widget" }));
    _resetPluginLoader(imported);
    const fetchMock = vi.fn(async () => new Response('import { useState } from "react"; export const Page = 1;', { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const changed = vi.fn();
    onRegistryChange(changed);

    await Promise.all([loadPluginModule(contribution), loadPluginModule(contribution)]);
    await loadPluginModule(contribution);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe("/_plugins/p1/ui/index.js?v=2026-10-28T00%3A00%3A00.000Z");
    expect(imported).toHaveBeenCalledTimes(1);
    expect(resolveRegisteredComponent("acme.fixture", "Page")).toEqual({ kind: "react", component: Page });
    expect(resolveRegisteredComponent("acme.fixture", "widget")).toEqual({ kind: "web-component", tagName: "x-widget" });
    expect(moduleState(contribution)).toEqual({ status: "loaded" });
    expect(changed).toHaveBeenCalled();
  });

  it("records a bundle that won't load instead of throwing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404, statusText: "Not Found" })));
    await expect(loadPluginModule(contribution)).resolves.toBeUndefined();
    expect(moduleState(contribution)).toEqual({ status: "error", message: "Couldn't fetch the plugin's UI bundle (404 Not Found)." });
    expect(resolveRegisteredComponent("acme.fixture", "Page")).toBeNull();
  });

  it("refuses to load before the React runtime is set up", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("__paperclipPluginBridge__", undefined);
    await loadPluginModule(contribution);
    expect(moduleState(contribution)).toEqual({ status: "error", message: "The plugin runtime isn't loaded." });
  });

  it("loads a new version afresh", async () => {
    _resetPluginLoader(async () => ({ Page: () => null }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 200 })));
    await loadPluginModule(contribution);
    expect(moduleState({ ...contribution, updatedAt: "2026-10-29T00:00:00.000Z" })).toBeNull();
  });
});
