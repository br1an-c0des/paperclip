import type { CompanySecret, SecretProviderDescriptor, SecretStatus, UserSecretDefinition } from "@paperclipai/shared";
import { Archive, ArchiveRestore, Ban, CheckCircle2, Ellipsis, KeyRound, Link2, Pencil, RefreshCw, Trash2 } from "lucide-solid";
import { Match, Show, Switch } from "solid-js";
import { Button } from "@/ui/Button";
import { Menu } from "@/ui/Menu";
import { nameInFolder, rotateLabel, type SecretRow } from "./secrets-model";

/*
 * Pieces the Secrets list, its details and My secrets share: a secret's name with its folders
 * muted, and a secret's actions menu. The actions themselves live in SecretsSection.tsx, which
 * holds the dialogs they open.
 */

/** What a row's menu and the details dialog can do, held here so both share the dialogs. */
export type SecretActions = {
  open: (row: SecretRow) => void;
  rotate: (secret: CompanySecret) => void;
  rename: (secret: CompanySecret) => void;
  editDefinition: (definition: UserSecretDefinition) => void;
  setMine: (definition: UserSecretDefinition) => void;
  setStatus: (row: SecretRow, status: SecretStatus) => void;
  remove: (row: SecretRow) => void;
  copyLink: () => void;
  goToVaults: () => void;
  /** The user's own entry for a definition, to say "Set my value" or "Update my value". */
  hasMine: (definitionId: string) => boolean;
  descriptors: () => SecretProviderDescriptor[] | undefined;
};

/** A name with its folders muted and its own name strong, from `base` down. */
export function SecretName(props: { name: string; base?: string; full?: boolean }) {
  const shown = () => (props.full ? props.name : nameInFolder(props.name, props.base ?? ""));
  const cut = () => shown().lastIndexOf("/");
  return (
    <span class="sec-name" title={props.name}>
      <Show when={cut() > 0} fallback={shown()}>
        <span class="sec-path">{shown().slice(0, cut() + 1)}</span>
        {shown().slice(cut() + 1)}
      </Show>
    </span>
  );
}

/** A secret's actions, in its row and in its details. */
export function RowMenu(props: { row: SecretRow; actions: SecretActions; inDetails?: boolean }) {
  const row = () => props.row;
  const statusItems = () => (
    <>
      <Menu.Item
        icon={row().status === "active" ? <Ban size={14} /> : row().status === "archived" ? <ArchiveRestore size={14} /> : <CheckCircle2 size={14} />}
        description={row().status === "active" ? "Agents don't get it until it's on again" : undefined}
        onSelect={() => props.actions.setStatus(row(), row().status === "active" ? "disabled" : "active")}
      >
        {row().status === "active" ? "Turn off" : row().status === "archived" ? "Restore" : "Turn on"}
      </Menu.Item>
      <Show when={row().status !== "archived"}>
        <Menu.Item icon={<Archive size={14} />} description="Hidden from the list until you ask for archived secrets" onSelect={() => props.actions.setStatus(row(), "archived")}>
          Archive
        </Menu.Item>
      </Show>
    </>
  );
  return (
    <Menu placement="bottom-end">
      <Menu.Trigger as={Button} variant="icon" ghost size="compact" aria-label={`${props.inDetails ? "More actions" : "Actions"} for ${row().name}`}>
        <Ellipsis size={16} aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Content label="Secret actions" width={270}>
        <Show when={!props.inDetails}>
          <Menu.Item icon={<KeyRound size={14} />} onSelect={() => props.actions.open(row())}>
            Details and agent access
          </Menu.Item>
        </Show>
        <Show when={props.inDetails}>
          <Menu.Item icon={<Link2 size={14} />} onSelect={props.actions.copyLink}>
            Copy link
          </Menu.Item>
        </Show>
        <Switch>
          <Match when={row().kind === "company" && (row() as Extract<SecretRow, { kind: "company" }>)}>
            {(found) => (
              <>
                <Show when={!props.inDetails}>
                  <Menu.Item icon={<RefreshCw size={14} />} onSelect={() => props.actions.rotate(found().secret)}>
                    {rotateLabel(found().secret, props.actions.descriptors())}
                  </Menu.Item>
                </Show>
                <Menu.Item icon={<Pencil size={14} />} description="A slash in the name files it in a folder" onSelect={() => props.actions.rename(found().secret)}>
                  Rename or describe
                </Menu.Item>
              </>
            )}
          </Match>
          <Match when={row().kind === "user" && (row() as Extract<SecretRow, { kind: "user" }>)}>
            {(found) => (
              <>
                <Show when={!props.inDetails}>
                  <Menu.Item icon={<KeyRound size={14} />} disabled={found().status !== "active"} onSelect={() => props.actions.setMine(found().definition)}>
                    {props.actions.hasMine(found().definition.id) ? "Update my value" : "Set my value"}
                  </Menu.Item>
                </Show>
                <Menu.Item icon={<Pencil size={14} />} onSelect={() => props.actions.editDefinition(found().definition)}>
                  Edit
                </Menu.Item>
              </>
            )}
          </Match>
        </Switch>
        <Menu.Separator />
        {statusItems()}
        <Menu.Separator />
        <Menu.Item danger icon={<Trash2 size={14} />} onSelect={() => props.actions.remove(row())}>
          Delete…
        </Menu.Item>
      </Menu.Content>
    </Menu>
  );
}

