import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pluginsApi, type PluginConfig } from "@/api/plugins";
import { secretsApi } from "@/api/secrets";
import { PluginConfigForm } from "./PluginConfigForm";
import type { JsonSchemaNode } from "./schema-form";

// U164 (#19847): a plugin with no saved configuration can save its defaults as they are.

const schema = {
  type: "object",
  properties: { region: { type: "string", title: "Region", default: "eu" } },
} as JsonSchemaNode;

let client: QueryClient;

function renderForm(props: { pluginId?: string; companyId?: string } = {}) {
  return render(() => (
    <QueryClientProvider client={client}>
      <PluginConfigForm pluginId={props.pluginId ?? "plugin-1"} companyId={props.companyId ?? "company-1"} schema={schema} ready supportsTest={false} />
    </QueryClientProvider>
  ));
}

const saveButton = () => screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;

describe("PluginConfigForm", () => {
  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.spyOn(secretsApi, "list").mockResolvedValue([]);
  });
  afterEach(() => cleanup());

  it("allows the first save of a plugin with nothing saved, with its defaults unchanged", async () => {
    vi.spyOn(pluginsApi, "config").mockResolvedValue(null);
    const saved = { configJson: { region: "eu" }, lastError: null } as unknown as PluginConfig;
    const saveConfig = vi.spyOn(pluginsApi, "saveConfig").mockResolvedValue(saved);
    renderForm();
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());
    await waitFor(() => expect(saveConfig).toHaveBeenCalledWith("plugin-1", "company-1", { region: "eu" }));
    // Saved: the form matches what's saved, so Save waits for a change again.
    await waitFor(() => expect(saveButton().disabled).toBe(true));
  });

  it("keeps Save off while a saved configuration is unchanged", async () => {
    vi.spyOn(pluginsApi, "config").mockResolvedValue({ configJson: { region: "us" }, lastError: null } as unknown as PluginConfig);
    renderForm();
    await screen.findByDisplayValue("us");
    expect(saveButton().disabled).toBe(true);
  });

  it("keeps Save off while the configuration can't be loaded", async () => {
    vi.spyOn(pluginsApi, "config").mockRejectedValue(new Error("Plugin offline"));
    renderForm();
    await screen.findByText(/Couldn't load the configuration/);
    expect(saveButton().disabled).toBe(true);
  });
});
