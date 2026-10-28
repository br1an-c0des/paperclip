import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, on, Show } from "solid-js";
import { pluginsApi } from "@/api/plugins";
import { queryKeys } from "@/api/queryKeys";
import { secretsApi } from "@/api/secrets";
import { Button } from "@/ui/Button";
import { SettingsCard } from "@/ui/Field";
import { pushToast } from "@/ui/Toast";
import { SchemaForm } from "./SchemaForm";
import { initialValues, validateValues, valuesDiffer, type JsonSchemaNode } from "./schema-form";

/*
 * A plugin's configuration form, generated from its `instanceConfigSchema` (PluginConfigForm in
 * ui/src/pages/PluginSettings.tsx). The configuration belongs to the company you're in
 * (`GET|POST /api/plugins/:id/config?companyId=`); the form starts from what's saved over the
 * schema's defaults, checks the values before saving, and the server checks them again. When the
 * plugin's worker can (`supportsConfigTest`), Test asks it to validate the values without saving.
 */

export function PluginConfigForm(props: {
  pluginId: string;
  companyId: string;
  schema: JsonSchemaNode;
  ready: boolean;
  supportsTest: boolean;
}) {
  const client = useQueryClient();
  const config = createQuery(() => ({
    queryKey: queryKeys.plugins.config(props.pluginId, props.companyId),
    queryFn: ({ signal }) => pluginsApi.config(props.pluginId, props.companyId, signal),
    retry: false,
  }));
  const secrets = createQuery(() => ({
    queryKey: queryKeys.projectSettings.secrets(props.companyId),
    queryFn: ({ signal }) => secretsApi.list(props.companyId, signal),
    retry: false,
  }));
  const saved = createMemo(() => initialValues(props.schema, config.data?.configJson));
  const [values, setValues] = createSignal<Record<string, unknown>>({});
  const [errors, setErrors] = createSignal<Record<string, string>>({});
  const [saving, setSaving] = createSignal(false);
  const [testing, setTesting] = createSignal(false);
  const [result, setResult] = createSignal<{ tone: "ok" | "bad"; text: string } | null>(null);

  // Take what's saved when it first loads (or the plugin or company changes), not on every refetch,
  // so a refresh never overwrites what's being typed.
  let hydratedFor = "";
  createEffect(
    on([() => config.isSuccess, () => props.pluginId, () => props.companyId], ([loaded]) => {
      const key = `${props.pluginId}:${props.companyId}`;
      if (!loaded || hydratedFor === key) return;
      hydratedFor = key;
      setValues(saved());
      setErrors({});
    }),
  );

  const dirty = () => config.isSuccess && valuesDiffer(values(), saved());

  const check = () => {
    const problems = validateValues(props.schema, values());
    setErrors(problems);
    return Object.keys(problems).length === 0;
  };

  const save = async () => {
    setResult(null);
    if (!check()) return;
    setSaving(true);
    try {
      const next = await pluginsApi.saveConfig(props.pluginId, props.companyId, values());
      client.setQueryData(queryKeys.plugins.config(props.pluginId, props.companyId), next);
      setValues(initialValues(props.schema, next.configJson));
      pushToast({ tone: "success", title: "Configuration saved" });
    } catch (caught) {
      setResult({ tone: "bad", text: caught instanceof Error && caught.message ? caught.message : "Couldn't save the configuration." });
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setResult(null);
    if (!check()) return;
    setTesting(true);
    try {
      const outcome = await pluginsApi.testConfig(props.pluginId, props.companyId, values());
      setResult(outcome.valid ? { tone: "ok", text: "The plugin accepted this configuration." } : { tone: "bad", text: outcome.message || "The plugin turned this configuration down." });
    } catch (caught) {
      setResult({ tone: "bad", text: caught instanceof Error && caught.message ? caught.message : "Couldn't test the configuration." });
    } finally {
      setTesting(false);
    }
  };

  return (
    <SettingsCard
      title="Configuration"
      description="Generated from the plugin's settings schema. It applies to this organization."
      footer={
        <>
          <Show when={result()}>
            {(current) => (
              <span class={current().tone === "ok" ? "sf-result sf-result--ok" : "field-error"} role={current().tone === "ok" ? "status" : "alert"}>
                {current().text}
              </span>
            )}
          </Show>
          <Show when={dirty()}>
            <Button ghost size="compact" disabled={saving()} onClick={() => (setValues(saved()), setErrors({}), setResult(null))}>
              Discard
            </Button>
          </Show>
          <Show when={props.ready && props.supportsTest}>
            <Button size="compact" disabled={testing() || saving() || !config.isSuccess} onClick={() => void test()}>
              {testing() ? "Testing…" : "Test"}
            </Button>
          </Show>
          <Button variant="primary" size="compact" disabled={!dirty() || saving()} onClick={() => void save()}>
            {saving() ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div class="sf-card-body">
        <Show
          when={config.isSuccess}
          fallback={
            <p class={config.isError ? "field-error" : "sf-muted"} role={config.isError ? "alert" : "status"}>
              {config.isError ? `Couldn't load the configuration: ${(config.error as Error).message}` : "Loading the configuration…"}
            </p>
          }
        >
          <Show when={config.data?.lastError}>
            {(problem) => (
              <p class="field-error" role="alert">
                The saved configuration has a problem: {problem()}
              </p>
            )}
          </Show>
          <SchemaForm
            schema={props.schema}
            values={values()}
            onChange={(next) => {
              setValues(next);
              setErrors({});
              setResult(null);
            }}
            errors={errors()}
            disabled={saving()}
            secrets={secrets.data}
          />
        </Show>
      </div>
    </SettingsCard>
  );
}
