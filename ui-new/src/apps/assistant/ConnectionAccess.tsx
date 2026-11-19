import type { AgentAccess, McpConnection, UpdateMcpConnection } from "@paperclipai/shared";
import { useQueryClient } from "@tanstack/solid-query";
import { Check } from "lucide-solid";
import { createMemo, For, Show } from "solid-js";
import { mcpApi } from "@/api/mcp";
import { ActionGroups, LevelRow } from "@/agents/settings/AccessControls";
import { overrideCount } from "@/agents/settings/access-model";
import { saveNote } from "@/projects/settings/shared";
import { useRunner } from "@/settings/company/shared";
import { Button } from "@/ui/Button";
import { FieldButton, SettingsRow } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { actAsChoices, connectionAccessLine, connectionAccessOf, connectionAccessPatch } from "./assistant-model";
import "./ConnectionAccess.css";

/*
 * An outside connection's access (step 4a), under its row in the connection lists (Connections →
 * Assistants and `/assistant-connections`): who it acts as (you, or an agent you may configure) and
 * its level, with the actions as on an agent's Access card (agents/settings/AccessControls.tsx).
 * Acting as an agent, it gets that agent's own access, capped by the level. The summary line stays
 * visible; the editor folds under "Change access". Every change saves at once through
 * `PATCH /mcp/connections/:id` (`updateMcpConnectionSchema`; overrides are sent whole), then the
 * list is read again.
 */

export function ConnectionAccess(props: { connection: McpConnection; queryKey: readonly unknown[] }) {
  const client = useQueryClient();
  const runner = useRunner(() => client.invalidateQueries({ queryKey: props.queryKey }));
  const access = createMemo(() => connectionAccessOf(props.connection));
  const choices = createMemo(() => actAsChoices(props.connection));
  const actingAs = () => props.connection.actAsAgent?.name ?? "You";
  const busy = () => runner.state() === "saving";
  const save = (patch: UpdateMcpConnection, fallback: string) =>
    void runner.run(async () => {
      const saved = await mcpApi.update(props.connection.id, patch);
      if (saved && typeof saved === "object" && "id" in saved) {
        client.setQueryData<McpConnection[]>(props.queryKey, (rows) => rows?.map((row) => (row.id === saved.id ? { ...row, ...saved } : row)));
      }
    }, fallback);
  const saveAccess = (next: AgentAccess, fallback: string) => save(connectionAccessPatch(next), fallback);
  const name = () => props.connection.clientName.trim() || "this connection";

  return (
    <div class="ca">
      <span class="ca-line">
        {connectionAccessLine(props.connection)}
        <Show when={runner.state() !== "idle"}> {saveNote(runner.state(), runner.error())}</Show>
      </span>
      <details class="ca-edit">
        <summary>Change access</summary>
        <div class="ca-body settings-rows">
          <SettingsRow label="Acts as" info="As you, it has your access, capped by its level. As an agent, it works as that agent, with the agent's own access capped by the level. You can pick the agents you may configure.">
            <Menu>
              <Menu.Trigger as={FieldButton} class="ps-field-240" disabled={busy()} aria-label={`Acts as: ${actingAs()}`}>
                {actingAs()}
              </Menu.Trigger>
              <Menu.Content label="Acts as" width={300}>
                <For each={choices()}>
                  {(choice) => (
                    <Menu.Item
                      hint={(props.connection.actAsAgent?.id ?? null) === choice.id ? <Check size={14} /> : undefined}
                      onSelect={() => (props.connection.actAsAgent?.id ?? null) !== choice.id && save({ actAsAgentId: choice.id }, "Couldn't change who it acts as.")}
                    >
                      {choice.name}
                    </Menu.Item>
                  )}
                </For>
              </Menu.Content>
            </Menu>
          </SettingsRow>
          <LevelRow
            access={access()}
            disabled={busy()}
            info={`The most ${name()} may do. Read only reads; worker works its own tasks; manager runs the board; admin also configures and hires agents and may call the whole API.`}
            onChange={saveAccess}
          />
          <ActionGroups access={access()} disabled={busy()} overrideLabel="Set for this connection" onChange={saveAccess} />
          <Show when={overrideCount(access()) > 0}>
            <div class="ca-foot">
              <Button size="compact" variant="quiet" disabled={busy()} onClick={() => saveAccess({ level: access().level }, "Couldn't reset the actions.")}>
                Reset all actions
              </Button>
            </div>
          </Show>
        </div>
      </details>
    </div>
  );
}
