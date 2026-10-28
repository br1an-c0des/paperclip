import { describe, expect, it } from "vitest";
import {
  boundSecretId,
  defaultValues,
  enumFromInput,
  errorsUnder,
  fieldKind,
  groupFields,
  hasAdvancedError,
  initialValues,
  labelFromKey,
  numberFromInput,
  objectFromInput,
  resolveType,
  validateField,
  validateValues,
  valuesDiffer,
  type JsonSchemaNode,
} from "./schema-form";

// The Kitchen Sink example plugin's schema, trimmed, plus the kinds it doesn't use.
const schema: JsonSchemaNode = {
  type: "object",
  required: ["apiKey", "retries"],
  properties: {
    showSidebarEntry: { type: "boolean", title: "Show Sidebar Entry", default: true },
    httpDemoUrl: { type: "string", default: "https://example.com" },
    apiKey: { type: "string", format: "secret-ref" },
    retries: { type: "integer", minimum: 0, maximum: 5 },
    mode: { type: "string", enum: ["fast", "safe"] },
    level: { enum: [1, 2, 3] },
    allowedCommands: { type: "array", items: { type: "string", enum: ["ls", "pwd"] }, default: ["ls"], maxItems: 2 },
    notes: { type: "string", maxLength: 500 },
    extra: { type: "object" },
    nested: { type: "object", properties: { title: { type: "string", minLength: 2 } } },
    sshHost: { type: "string", "x-paperclip-advanced": true, "x-paperclip-group": "SSH access" },
    timeout: { type: "number", "x-paperclip-advanced": true },
  },
};

describe("field kinds", () => {
  it("picks the control from the schema", () => {
    const kinds = Object.fromEntries(Object.entries(schema.properties!).map(([key, node]) => [key, fieldKind(node)]));
    expect(kinds).toEqual({
      showSidebarEntry: "boolean",
      httpDemoUrl: "string",
      apiKey: "secret-ref",
      retries: "integer",
      mode: "enum",
      level: "enum",
      allowedCommands: "array",
      notes: "textarea",
      extra: "json-object",
      nested: "object",
      sshHost: "string",
      timeout: "number",
    });
  });

  it("reads nullable types and labels keys", () => {
    expect(resolveType({ type: ["null", "integer"] })).toBe("integer");
    expect(labelFromKey("httpDemoUrl", {})).toBe("Http Demo Url");
    expect(labelFromKey("snake_case-key", {})).toBe("Snake Case Key");
    expect(labelFromKey("x", { title: "Given" })).toBe("Given");
  });
});

describe("defaults", () => {
  it("starts from the schema's defaults, leaving optional scalars and objects absent", () => {
    expect(defaultValues(schema)).toEqual({ showSidebarEntry: true, httpDemoUrl: "https://example.com", allowedCommands: ["ls"] });
  });

  it("puts saved values over the defaults", () => {
    expect(initialValues(schema, { showSidebarEntry: false, retries: 2 })).toMatchObject({ showSidebarEntry: false, retries: 2, allowedCommands: ["ls"] });
    expect(initialValues(schema, null)).toEqual(defaultValues(schema));
  });

  it("materializes a required object's fields", () => {
    expect(defaultValues({ type: "object", required: ["box"], properties: { box: { type: "object", properties: { on: { type: "boolean" } } } } })).toEqual({ box: { on: false } });
  });
});

describe("validation", () => {
  it("flags required, bounds, patterns and item problems by JSON pointer", () => {
    const errors = validateValues(schema, {
      retries: 9,
      mode: "slow",
      allowedCommands: ["ls", "rm", "pwd"],
      nested: { title: "x" },
      extra: "{not json",
    });
    expect(errors).toEqual({
      "/apiKey": "This field is required",
      "/retries": "Must be at most 5",
      "/mode": "Pick one of the options",
      "/allowedCommands": "Must have at most 2 items",
      "/allowedCommands/1": "Pick one of the options",
      "/nested/title": "Must be at least 2 characters",
      "/extra": "Enter a valid JSON object",
    });
  });

  it("accepts secret references and numeric enums", () => {
    expect(validateField({ type: "secret_ref", secretId: "s1", version: "latest" }, { format: "secret-ref" }, true)).toBeNull();
    expect(validateField({ foo: 1 }, { format: "secret-ref" }, false)).toBe("Invalid secret reference");
    expect(validateField(2, { enum: [1, 2, 3] }, true)).toBeNull();
    expect(validateField(1.5, { type: "integer" }, false)).toBe("Must be a whole number");
    expect(validateField("abc", { type: "number" }, false)).toBe("Must be a valid number");
  });

  it("ignores a broken pattern instead of blocking the save", () => {
    expect(validateField("anything", { type: "string", pattern: "([" }, false)).toBeNull();
    expect(validateField("abc", { type: "string", pattern: "^\\d+$" }, false)).toBe("Must match pattern: ^\\d+$");
  });
});

describe("advanced fields", () => {
  it("groups them in order, under More options by default, and opens on their errors", () => {
    const groups = groupFields(schema);
    expect(groups.essentials.map((field) => field.key)).not.toContain("sshHost");
    expect(groups.advanced.map((group) => [group.group, group.fields.map((field) => field.key)])).toEqual([
      ["SSH access", ["sshHost"]],
      ["More options", ["timeout"]],
    ]);
    expect(hasAdvancedError(groups, { "/timeout": "Must be a valid number" })).toBe(true);
    expect(hasAdvancedError(groups, { "/retries": "Must be at most 5" })).toBe(false);
  });

  it("re-keys a nested object's errors", () => {
    expect(errorsUnder({ "/nested/title": "short", "/nestedOther": "no", "/retries": "x" }, "/nested")).toEqual({ "/title": "short" });
  });
});

describe("inputs", () => {
  it("turns field text into values", () => {
    expect(numberFromInput("")).toBeUndefined();
    expect(numberFromInput(" 4 ")).toBe(4);
    expect(numberFromInput("4x")).toBe("4x");
    expect(objectFromInput('{"a":1}')).toEqual({ a: 1 });
    expect(objectFromInput("[1]")).toBe("[1]");
    expect(objectFromInput(" ")).toBeUndefined();
    expect(enumFromInput("2", [1, 2])).toBe(2);
    expect(enumFromInput("", ["a"])).toBeUndefined();
  });

  it("finds the secret a field is bound to", () => {
    expect(boundSecretId({ type: "secret_ref", secretId: "s1" })).toBe("s1");
    expect(boundSecretId("6f1c4c1e-8c5e-4c2a-9c7a-1f2e3d4c5b6a")).toBe("6f1c4c1e-8c5e-4c2a-9c7a-1f2e3d4c5b6a");
    expect(boundSecretId("raw value")).toBeNull();
  });

  it("compares values ignoring key order", () => {
    expect(valuesDiffer({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 })).toBe(false);
    expect(valuesDiffer({ a: [1, 2] }, { a: [2, 1] })).toBe(true);
  });
});
