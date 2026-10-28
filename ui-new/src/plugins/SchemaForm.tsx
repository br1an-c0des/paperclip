import type { CompanySecret } from "@paperclipai/shared";
import { ChevronRight, Eye, EyeOff, Plus, Trash2 } from "lucide-solid";
import { createEffect, createMemo, createSignal, createUniqueId, For, Index, Match, Show, Switch, type JSX } from "solid-js";
import { Button } from "@/ui/Button";
import { TextArea, TextInput } from "@/ui/Field";
import { Switch as Toggle } from "@/ui/Switch";
import {
  boundSecretId,
  defaultForSchema,
  enumFromInput,
  errorsUnder,
  fieldKind,
  groupFields,
  hasAdvancedError,
  labelFromKey,
  numberFromInput,
  objectFromInput,
  type FieldEntry,
  type JsonSchemaNode,
} from "./schema-form";

/*
 * A form generated from a JSON schema (ui/src/components/JsonSchemaForm.tsx), for plugins that
 * configure themselves through `instanceConfigSchema`: text and long text, numbers, switches,
 * option lists, secrets, lists you add to and remove from, nested groups, and free-form JSON for
 * objects without declared fields. Fields marked `x-paperclip-advanced` sit behind a disclosure,
 * grouped by `x-paperclip-group`, which opens by itself when one of them has a problem.
 *
 * Secret fields (`format: "secret-ref"`) pick one of the company's secrets, stored by reference, or
 * take a raw value the server stores as a secret on save, as the old form does.
 */

export type SchemaFormProps = {
  schema: JsonSchemaNode;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  /** Problems keyed by JSON pointer, from validateValues(). */
  errors?: Record<string, string>;
  disabled?: boolean;
  /** The company's secrets, for secret fields. */
  secrets?: readonly CompanySecret[];
  advancedLabel?: string;
};

type FieldProps = {
  schema: JsonSchemaNode;
  value: unknown;
  onChange: (value: unknown) => void;
  path: string;
  label: string;
  required?: boolean;
  errors: Record<string, string>;
  disabled?: boolean;
  secrets?: readonly CompanySecret[];
  idPrefix: string;
};

export function SchemaForm(props: SchemaFormProps) {
  const idPrefix = createUniqueId();
  const groups = createMemo(() => groupFields(props.schema));
  const errors = () => props.errors ?? {};
  const [advancedOpen, setAdvancedOpen] = createSignal(false);
  // A problem on a hidden field opens the disclosure; it never closes by itself.
  createEffect(() => {
    if (hasAdvancedError(groups(), errors())) setAdvancedOpen(true);
  });

  const field = (entry: FieldEntry) => (
    <SchemaField
      schema={entry.schema}
      value={props.values[entry.key]}
      onChange={(value) => props.onChange({ ...props.values, [entry.key]: value })}
      path={`/${entry.key}`}
      label={labelFromKey(entry.key, entry.schema)}
      required={(props.schema.required ?? []).includes(entry.key)}
      errors={errors()}
      disabled={props.disabled}
      secrets={props.secrets}
      idPrefix={idPrefix}
    />
  );

  return (
    <div class="sf">
      <Show when={Object.keys(props.schema.properties ?? {}).length > 0} fallback={<p class="sf-muted">No configuration options available.</p>}>
        <For each={groups().essentials}>{field}</For>
        <Show when={groups().advanced.length > 0}>
          <div class="sf-advanced">
            <button type="button" class="sf-disclosure" aria-expanded={advancedOpen()} onClick={() => setAdvancedOpen(!advancedOpen())}>
              <ChevronRight size={14} aria-hidden="true" class="sf-chevron" />
              {props.advancedLabel ?? "Advanced options"}
            </button>
            <Show when={advancedOpen()}>
              <For each={groups().advanced}>
                {(group) => (
                  <div class="sf-group" role="group" aria-label={group.group}>
                    <h4 class="sf-group-title">{group.group}</h4>
                    <For each={group.fields}>{field}</For>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </Show>
      </Show>
    </div>
  );
}

/** One field, by its schema's kind. */
export function SchemaField(props: FieldProps) {
  const id = () => `sf${props.idPrefix}${props.path.replace(/[^\w-]/g, "-")}`;
  const error = () => props.errors[props.path];
  const disabled = () => props.disabled || props.schema.readOnly === true;
  const kind = () => fieldKind(props.schema);

  return (
    <Switch>
      <Match when={kind() === "boolean"}>
        <div class="sf-field">
          <Toggle
            checked={props.value === true}
            onChange={(checked) => props.onChange(checked)}
            label={props.label || "On"}
            description={props.schema.description}
            disabled={disabled()}
          />
          <FieldError message={error()} />
        </div>
      </Match>
      <Match when={kind() === "array"}>
        <ArrayField {...props} />
      </Match>
      <Match when={kind() === "object"}>
        <ObjectField {...props} />
      </Match>
      <Match when={kind() === "secret-ref"}>
        <Labelled id={id()} label={props.label} required={props.required} description={props.schema.description ?? "Pick one of the organization's secrets, or paste a value (Paperclip stores it as a secret when you save)."} error={error()}>
          <SecretField {...props} id={id()} disabled={disabled()} />
        </Labelled>
      </Match>
      <Match when={true}>
        <Labelled id={id()} label={props.label} required={props.required} description={props.schema.description} error={error()}>
          <Switch>
            <Match when={kind() === "enum"}>
              <select
                id={id()}
                class="input sf-select"
                value={props.value === undefined || props.value === null ? "" : String(props.value)}
                disabled={disabled()}
                aria-invalid={Boolean(error()) || undefined}
                aria-required={props.required || undefined}
                onChange={(event) => props.onChange(enumFromInput(event.currentTarget.value, props.schema.enum ?? []))}
              >
                <option value="" disabled={props.required}>
                  {props.required ? "Pick one" : "None"}
                </option>
                <For each={props.schema.enum ?? []}>{(option) => <option value={String(option)}>{String(option)}</option>}</For>
              </select>
            </Match>
            <Match when={kind() === "const"}>
              <span class="mono sf-const">{String(props.schema.const)}</span>
            </Match>
            <Match when={kind() === "number" || kind() === "integer"}>
              <TextInput
                id={id()}
                type="text"
                inputmode={kind() === "integer" ? "numeric" : "decimal"}
                value={props.value === undefined || props.value === null ? "" : String(props.value)}
                placeholder={props.schema.default !== undefined ? String(props.schema.default) : undefined}
                disabled={disabled()}
                invalid={Boolean(error())}
                aria-required={props.required || undefined}
                onInput={(event) => props.onChange(numberFromInput(event.currentTarget.value))}
              />
            </Match>
            <Match when={kind() === "json-object"}>
              <JsonObjectInput {...props} id={id()} disabled={disabled()} invalid={Boolean(error())} />
            </Match>
            <Match when={kind() === "textarea"}>
              <TextArea
                id={id()}
                rows={4}
                value={typeof props.value === "string" ? props.value : props.value === undefined || props.value === null ? "" : String(props.value)}
                placeholder={props.schema.default !== undefined ? String(props.schema.default) : undefined}
                disabled={disabled()}
                invalid={Boolean(error())}
                aria-required={props.required || undefined}
                onInput={(event) => props.onChange(event.currentTarget.value)}
              />
            </Match>
            <Match when={true}>
              <TextInput
                id={id()}
                value={props.value === undefined || props.value === null ? "" : String(props.value)}
                placeholder={props.schema.default !== undefined ? String(props.schema.default) : undefined}
                disabled={disabled()}
                invalid={Boolean(error())}
                aria-required={props.required || undefined}
                onInput={(event) => props.onChange(event.currentTarget.value)}
              />
            </Match>
          </Switch>
        </Labelled>
      </Match>
    </Switch>
  );
}

function Labelled(props: { id: string; label: string; required?: boolean; description?: string; error?: string; children: JSX.Element }) {
  return (
    <div class="sf-field">
      <Show when={props.label}>
        <label class="sf-label" for={props.id}>
          {props.label}
          <Show when={props.required}>
            <span class="sf-required" aria-hidden="true">
              {" "}
              *
            </span>
          </Show>
        </label>
      </Show>
      {props.children}
      <Show when={props.description && !props.error}>
        <span class="fhelp">{props.description}</span>
      </Show>
      <FieldError message={props.error} />
    </div>
  );
}

function FieldError(props: { message?: string }) {
  return (
    <Show when={props.message}>
      <span class="field-error" role="alert">
        {props.message}
      </span>
    </Show>
  );
}

function ArrayField(props: FieldProps) {
  const items = () => (Array.isArray(props.value) ? (props.value as unknown[]) : []);
  const item = () => props.schema.items ?? { type: "string" };
  const disabled = () => props.disabled || props.schema.readOnly === true;
  const full = () => props.schema.maxItems !== undefined && items().length >= props.schema.maxItems;
  const atMinimum = () => props.schema.minItems !== undefined && items().length <= props.schema.minItems;
  const set = (index: number, value: unknown) => props.onChange(items().map((entry, at) => (at === index ? value : entry)));
  return (
    <fieldset class="sf-field sf-box" aria-invalid={Boolean(props.errors[props.path]) || undefined}>
      <legend class="sf-label">{props.label}</legend>
      <Show when={props.schema.description}>
        <span class="fhelp">{props.schema.description}</span>
      </Show>
      <Index each={items()} fallback={<p class="sf-muted sf-empty">Nothing added yet.</p>}>
        {(entry, index) => (
          <div class="sf-item">
            <div class="sf-item-body">
              <SchemaField
                schema={item()}
                value={entry()}
                onChange={(value) => set(index, value)}
                path={`${props.path}/${index}`}
                label={`Item ${index + 1}`}
                errors={props.errors}
                disabled={disabled()}
                secrets={props.secrets}
                idPrefix={props.idPrefix}
              />
            </div>
            <button
              type="button"
              class="btn btn--icon btn--ghost btn--compact"
              aria-label={`Remove item ${index + 1} from ${props.label}`}
              disabled={disabled() || atMinimum()}
              onClick={() => props.onChange(items().filter((_, at) => at !== index))}
            >
              <Trash2 size={14} aria-hidden="true" />
            </button>
          </div>
        )}
      </Index>
      <div>
        <Button size="compact" icon={<Plus size={14} aria-hidden="true" />} disabled={disabled() || full()} onClick={() => props.onChange([...items(), defaultForSchema(item())])}>
          Add
        </Button>
      </div>
      <FieldError message={props.errors[props.path]} />
    </fieldset>
  );
}

function ObjectField(props: FieldProps) {
  const values = () => (props.value && typeof props.value === "object" && !Array.isArray(props.value) ? (props.value as Record<string, unknown>) : {});
  return (
    <details class="sf-field sf-box sf-object" open>
      <summary class="sf-label">
        <ChevronRight size={14} aria-hidden="true" class="sf-chevron" />
        {props.label}
      </summary>
      <Show when={props.schema.description}>
        <span class="fhelp">{props.schema.description}</span>
      </Show>
      <SchemaForm
        schema={props.schema}
        values={values()}
        onChange={(next) => props.onChange(next)}
        errors={errorsUnder(props.errors, props.path)}
        disabled={props.disabled || props.schema.readOnly === true}
        secrets={props.secrets}
      />
      <FieldError message={props.errors[props.path]} />
    </details>
  );
}

/** Free-form JSON for an object without declared fields. The text is kept while it doesn't parse. */
function JsonObjectInput(props: FieldProps & { id: string; disabled?: boolean; invalid?: boolean }) {
  const format = (value: unknown) => (typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value, null, 2));
  const [text, setText] = createSignal(format(props.value));
  let emitted: unknown = props.value;
  createEffect(() => {
    const value = props.value;
    if (value !== emitted) setText(format(value));
  });
  return (
    <TextArea
      id={props.id}
      class="mono"
      rows={5}
      value={text()}
      disabled={props.disabled}
      invalid={props.invalid}
      onInput={(event) => {
        setText(event.currentTarget.value);
        emitted = objectFromInput(event.currentTarget.value);
        props.onChange(emitted);
      }}
    />
  );
}

function SecretField(props: FieldProps & { id: string; disabled?: boolean }) {
  const bound = () => boundSecretId(props.value);
  const raw = () => (typeof props.value === "string" && !bound() ? props.value : "");
  const [rawOpen, setRawOpen] = createSignal(raw().length > 0);
  const [visible, setVisible] = createSignal(false);
  createEffect(() => {
    if (raw().length > 0) setRawOpen(true);
  });
  const options = createMemo(() => (props.secrets ?? []).filter((secret) => secret.status === "active" || secret.id === bound()));
  const unknownBound = () => {
    const id = bound();
    return id !== null && !options().some((secret) => secret.id === id);
  };
  return (
    <div class="sf-secret">
      <select
        id={props.id}
        class="input sf-select"
        value={bound() ?? ""}
        disabled={props.disabled}
        aria-invalid={Boolean(props.errors[props.path]) || undefined}
        onChange={(event) => {
          const secretId = event.currentTarget.value;
          if (secretId) {
            props.onChange({ type: "secret_ref", secretId, version: "latest" });
            setRawOpen(false);
            setVisible(false);
          } else props.onChange("");
        }}
      >
        <option value="">{options().length ? "No secret" : "No secrets yet"}</option>
        <Show when={unknownBound()}>
          <option value={bound()!}>A secret you can't see</option>
        </Show>
        <For each={options()}>{(secret) => <option value={secret.id}>{secret.name}</option>}</For>
      </select>
      <Show when={!bound()}>
        <Show
          when={rawOpen()}
          fallback={
            <button type="button" class="sf-link" disabled={props.disabled} onClick={() => setRawOpen(true)}>
              Or paste a value
            </button>
          }
        >
          <div class="sf-secret-raw">
            <TextInput
              type={visible() ? "text" : "password"}
              value={raw()}
              aria-label={`${props.label || "Secret"} value`}
              autocomplete="off"
              disabled={props.disabled}
              onInput={(event) => props.onChange(event.currentTarget.value)}
            />
            <button
              type="button"
              class="btn btn--icon btn--ghost btn--compact"
              aria-label={visible() ? "Hide the value" : "Show the value"}
              aria-pressed={visible()}
              disabled={props.disabled}
              onClick={() => setVisible(!visible())}
            >
              <Show when={visible()} fallback={<Eye size={14} aria-hidden="true" />}>
                <EyeOff size={14} aria-hidden="true" />
              </Show>
            </button>
          </div>
        </Show>
      </Show>
    </div>
  );
}
