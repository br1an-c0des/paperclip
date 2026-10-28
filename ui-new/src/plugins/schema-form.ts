/*
 * The rules behind a form generated from a JSON schema (a plugin's `instanceConfigSchema`), ported
 * from ui/src/components/JsonSchemaForm.tsx: which control a schema node gets, its label, the
 * default values a new form starts with, validation (errors keyed by JSON pointer, `/key/0/sub`),
 * and the advanced fields (`x-paperclip-advanced`, grouped by `x-paperclip-group`). No Solid here,
 * so it's tested on its own.
 */

export type JsonSchemaNode = {
  type?: string | string[];
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  examples?: unknown[];
  const?: unknown;
  format?: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  additionalProperties?: boolean | JsonSchemaNode;
  items?: JsonSchemaNode;
  minItems?: number;
  maxItems?: number;
  readOnly?: boolean;
  writeOnly?: boolean;
  "x-paperclip-advanced"?: boolean;
  "x-paperclip-group"?: string;
  [key: string]: unknown;
};

export type FieldKind = "string" | "textarea" | "number" | "integer" | "boolean" | "enum" | "const" | "secret-ref" | "array" | "object" | "json-object";

/** A company secret by reference, as the server stores it (`EnvSecretRefBinding`). */
export type SecretRefBinding = { type: "secret_ref"; secretId: string; version?: number | "latest" };

/** Strings longer than this get a text area. */
export const TEXTAREA_THRESHOLD = 200;
const MAX_PATTERN_LENGTH = 512;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The schema's primary type: `enum`, `const` and `secret-ref` win over `type`. */
export function resolveType(schema: JsonSchemaNode): string {
  if (schema.enum) return "enum";
  if (schema.const !== undefined) return "const";
  if (schema.format === "secret-ref") return "secret-ref";
  if (Array.isArray(schema.type)) return schema.type.find((type) => type !== "null") ?? "string";
  return schema.type ?? "string";
}

/** Which control renders the node. */
export function fieldKind(schema: JsonSchemaNode): FieldKind {
  const type = resolveType(schema);
  switch (type) {
    case "boolean":
    case "enum":
    case "const":
    case "secret-ref":
    case "number":
    case "integer":
    case "array":
      return type;
    case "object":
      // An object with no declared fields takes free-form JSON.
      return Object.keys(schema.properties ?? {}).length === 0 && schema.additionalProperties !== false ? "json-object" : "object";
    default:
      return schema.format === "textarea" || (schema.maxLength ?? 0) > TEXTAREA_THRESHOLD ? "textarea" : "string";
  }
}

/** The schema's title, or the key in words: `httpDemoUrl` is "Http Demo Url". */
export function labelFromKey(key: string, schema: JsonSchemaNode): string {
  if (schema.title) return schema.title;
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function isSecretRefBinding(value: unknown): value is SecretRefBinding {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { type?: unknown }).type === "secret_ref" &&
    typeof (value as { secretId?: unknown }).secretId === "string"
  );
}

export function isUuidLike(value: unknown) {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

/** The secret a secret-ref field points at: a binding, or a bare id saved by older versions. */
export function boundSecretId(value: unknown): string | null {
  if (isSecretRefBinding(value)) return value.secretId;
  return isUuidLike(value) ? (value as string).trim() : null;
}

/** An optional object with no default stays absent until it's filled in. */
function skipsDefault(key: string, schema: JsonSchemaNode, required: Set<string>) {
  return resolveType(schema) === "object" && !required.has(key) && schema.default === undefined;
}

/**
 * A node's starting value. Optional strings and numbers without a default start absent, so an
 * untouched field isn't sent as `""` or `0`.
 */
export function defaultForSchema(schema: JsonSchemaNode): unknown {
  if (schema.default !== undefined) return schema.default;
  switch (resolveType(schema)) {
    case "boolean":
      return false;
    case "array":
      return [];
    case "object": {
      if (!schema.properties) return {};
      const required = new Set(schema.required ?? []);
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(schema.properties)) {
        if (skipsDefault(key, child, required)) continue;
        const value = defaultForSchema(child);
        if (value !== undefined) out[key] = value;
      }
      return out;
    }
    default:
      return undefined;
  }
}

/** The values a form for an object schema starts with. */
export function defaultValues(schema: JsonSchemaNode): Record<string, unknown> {
  const value = defaultForSchema({ ...schema, default: undefined, type: "object" });
  return (value as Record<string, unknown>) ?? {};
}

/** Saved values over the schema's defaults. */
export function initialValues(schema: JsonSchemaNode, saved: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return { ...defaultValues(schema), ...(saved ?? {}) };
}

const empty = (value: unknown) => value === undefined || value === null || value === "";

/** One value against its node's own constraints, or null when it's fine. */
export function validateField(value: unknown, schema: JsonSchemaNode, required: boolean): string | null {
  const type = resolveType(schema);
  if (required && empty(value)) return "This field is required";
  if (empty(value)) return null;

  if (type === "secret-ref" && isSecretRefBinding(value)) return null;
  if (type === "secret-ref" && typeof value === "object") return "Invalid secret reference";
  if (type === "object" && (typeof value !== "object" || Array.isArray(value))) return "Enter a valid JSON object";

  if (type === "string" || type === "secret-ref") {
    const text = String(value);
    if (schema.minLength != null && text.length < schema.minLength) return `Must be at least ${schema.minLength} characters`;
    if (schema.maxLength != null && text.length > schema.maxLength) return `Must be at most ${schema.maxLength} characters`;
    // Plugin schemas are trusted less than our own code: skip long patterns and bad ones.
    if (schema.pattern && schema.pattern.length <= MAX_PATTERN_LENGTH) {
      try {
        if (!new RegExp(schema.pattern).test(text)) return `Must match pattern: ${schema.pattern}`;
      } catch {
        // An invalid pattern in the schema isn't the person's problem.
      }
    }
  }

  if (type === "number" || type === "integer") {
    const number = Number(value);
    if (Number.isNaN(number)) return "Must be a valid number";
    if (schema.minimum != null && number < schema.minimum) return `Must be at least ${schema.minimum}`;
    if (schema.maximum != null && number > schema.maximum) return `Must be at most ${schema.maximum}`;
    if (schema.exclusiveMinimum != null && number <= schema.exclusiveMinimum) return `Must be greater than ${schema.exclusiveMinimum}`;
    if (schema.exclusiveMaximum != null && number >= schema.exclusiveMaximum) return `Must be less than ${schema.exclusiveMaximum}`;
    if (type === "integer" && !Number.isInteger(number)) return "Must be a whole number";
    if (schema.multipleOf != null && number % schema.multipleOf !== 0) return `Must be a multiple of ${schema.multipleOf}`;
  }

  if (type === "array" && Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) return `Must have at least ${schema.minItems} items`;
    if (schema.maxItems != null && value.length > schema.maxItems) return `Must have at most ${schema.maxItems} items`;
  }

  if (type === "enum" && schema.enum && !schema.enum.some((option) => option === value)) return "Pick one of the options";
  return null;
}

/** Every problem in an object's values, keyed by JSON pointer (`/key`, `/list/0`, `/group/key`). */
export function validateValues(schema: JsonSchemaNode, values: Record<string, unknown>, path: string[] = []): Record<string, string> {
  const errors: Record<string, string> = {};
  const required = new Set(schema.required ?? []);
  for (const [key, child] of Object.entries(schema.properties ?? {})) {
    const at = [...path, key];
    const value = values?.[key];
    const problem = validateField(value, child, required.has(key));
    if (problem) errors[pointer(at)] = problem;
    const type = resolveType(child);
    if (type === "object" && child.properties && typeof value === "object" && value !== null && !Array.isArray(value)) {
      Object.assign(errors, validateValues(child, value as Record<string, unknown>, at));
    }
    if (type === "array" && child.items && Array.isArray(value)) {
      const item = child.items;
      value.forEach((entry, index) => {
        const itemAt = [...at, String(index)];
        if (resolveType(item) === "object") Object.assign(errors, validateValues(item, (entry ?? {}) as Record<string, unknown>, itemAt));
        else {
          const itemProblem = validateField(entry, item, false);
          if (itemProblem) errors[pointer(itemAt)] = itemProblem;
        }
      });
    }
  }
  return errors;
}

export function pointer(path: readonly string[]) {
  return `/${path.join("/")}`;
}

export type FieldEntry = { key: string; schema: JsonSchemaNode };
export type FieldGroups = { essentials: FieldEntry[]; advanced: { group: string; fields: FieldEntry[] }[] };

/** Essential fields in order, and the advanced ones grouped (in the order their groups appear). */
export function groupFields(schema: JsonSchemaNode): FieldGroups {
  const essentials: FieldEntry[] = [];
  const groups = new Map<string, FieldEntry[]>();
  for (const [key, child] of Object.entries(schema.properties ?? {})) {
    if (child["x-paperclip-advanced"] !== true) {
      essentials.push({ key, schema: child });
      continue;
    }
    const raw = child["x-paperclip-group"];
    const group = typeof raw === "string" && raw ? raw : "More options";
    groups.set(group, [...(groups.get(group) ?? []), { key, schema: child }]);
  }
  return { essentials, advanced: [...groups].map(([group, fields]) => ({ group, fields })) };
}

/** Whether any error sits on an advanced field, so its disclosure opens. */
export function hasAdvancedError(groups: FieldGroups, errors: Record<string, string>) {
  const keys = new Set(groups.advanced.flatMap((group) => group.fields.map((field) => field.key)));
  return Object.keys(errors).some((key) => keys.has(key.replace(/^\//, "").split("/")[0] ?? ""));
}

/** The errors under one object field, re-keyed relative to it. */
export function errorsUnder(errors: Record<string, string>, path: string): Record<string, string> {
  const prefix = `${path}/`;
  return Object.fromEntries(Object.entries(errors).flatMap(([key, value]) => (key.startsWith(prefix) ? [[key.slice(path.length), value]] : [])));
}

/** Whether the form differs from what was loaded. Key order doesn't count. */
export function valuesDiffer(a: unknown, b: unknown): boolean {
  return stableJson(a) !== stableJson(b);
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) =>
    entry && typeof entry === "object" && !Array.isArray(entry)
      ? Object.fromEntries(Object.entries(entry as Record<string, unknown>).sort(([x], [y]) => x.localeCompare(y)))
      : entry,
  );
}

/**
 * What a number field's text becomes: absent when cleared, a number when it reads as one, and the
 * text itself otherwise (so validation can say what's wrong).
 */
export function numberFromInput(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const number = Number(trimmed);
  return Number.isNaN(number) ? trimmed : number;
}

/** What a free-form JSON object field's text becomes: the object when it parses as one. */
export function objectFromInput(text: string): unknown {
  if (!text.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    // Keep the text so validation stops the save.
  }
  return text;
}

/** An enum option's value back from the select: numbers stay numbers. */
export function enumFromInput(text: string, options: readonly unknown[]): unknown {
  if (text === "") return undefined;
  return options.find((option) => String(option) === text) ?? text;
}
