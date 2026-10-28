import type { CompanySecret } from "@paperclipai/shared";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { SchemaForm } from "./SchemaForm";
import type { JsonSchemaNode } from "./schema-form";

const schema: JsonSchemaNode = {
  type: "object",
  required: ["url"],
  properties: {
    url: { type: "string", title: "Server URL", description: "Where it calls." },
    enabled: { type: "boolean", title: "Enabled" },
    mode: { enum: ["fast", "safe"], title: "Mode" },
    retries: { type: "integer", title: "Retries" },
    commands: { type: "array", title: "Commands", items: { type: "string" } },
    token: { type: "string", format: "secret-ref", title: "Token" },
    host: { type: "string", title: "Host", "x-paperclip-advanced": true },
  },
};

const secrets = [{ id: "s1", name: "GITHUB_TOKEN", status: "active" }] as unknown as CompanySecret[];

function setup(errors: Record<string, string> = {}) {
  const [values, setValues] = createSignal<Record<string, unknown>>({ url: "https://a.example" });
  render(() => <SchemaForm schema={schema} values={values()} onChange={setValues} errors={errors} secrets={secrets} />);
  return values;
}

afterEach(cleanup);

describe("SchemaForm", () => {
  it("renders each kind and reports changes", () => {
    const values = setup();
    fireEvent.input(screen.getByLabelText(/Server URL/), { target: { value: "https://b.example" } });
    fireEvent.change(screen.getByLabelText("Mode"), { target: { value: "safe" } });
    fireEvent.input(screen.getByLabelText("Retries"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("switch", { name: "Enabled" }));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.change(screen.getByLabelText("Token"), { target: { value: "s1" } });
    expect(values()).toEqual({
      url: "https://b.example",
      mode: "safe",
      retries: 3,
      enabled: true,
      commands: [undefined],
      token: { type: "secret_ref", secretId: "s1", version: "latest" },
    });
  });

  it("hides advanced fields until opened, and opens for their errors", () => {
    setup();
    expect(screen.queryByLabelText("Host")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Advanced options" }));
    expect(screen.getByLabelText("Host")).toBeTruthy();
    cleanup();
    setup({ "/host": "Must be at least 3 characters" });
    expect(screen.getByLabelText("Host")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("Must be at least 3 characters");
  });

  it("takes a raw secret value when no secret is picked", () => {
    const values = setup();
    fireEvent.click(screen.getByRole("button", { name: "Or paste a value" }));
    fireEvent.input(screen.getByLabelText("Token value"), { target: { value: "ghp_x" } });
    expect(values().token).toBe("ghp_x");
  });
});
