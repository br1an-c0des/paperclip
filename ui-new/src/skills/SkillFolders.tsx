import type { FolderListItem } from "@paperclipai/shared";
import { Check, ChevronDown, Folder, FolderPlus, Pencil, Trash2, User } from "lucide-solid";
import { createMemo, createSignal, For, Show } from "solid-js";
import { skillsApi } from "@/api/skills";
import { ConfirmDialog } from "@/documents/ConfirmDialog";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Field, TextInput } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { pushToast } from "@/ui/Toast";
import { failureText, useRefreshSkills } from "./queries";
import { folderEditable, folderNameProblem, folderTree, type FolderPick } from "./skills-model";

/*
 * The library's folders (the old library's folder rail, `GET /companies/:id/folders?kind=skill`):
 * a toolbar pill that narrows the list to a folder and the folders under it, or to skills in no
 * folder, with the counts the server keeps. Its menu also makes a folder, opens your own folder
 * ("My skills", `POST …/folders/ensure-my`), and manages the others (rename, remove). Bundled
 * skills sit in system folders, which can't be changed. Moving a skill is the detail's Folder.
 */

export function FolderMenu(props: {
  folders: readonly FolderListItem[];
  allCount: number;
  unfiledCount: number;
  value: FolderPick;
  onPick: (pick: FolderPick) => void;
}) {
  const company = useCompany();
  const refresh = useRefreshSkills();
  const tree = createMemo(() => folderTree(props.folders));
  const [creating, setCreating] = createSignal(false);
  const [managing, setManaging] = createSignal(false);
  const current = () =>
    props.value === "all" ? "All folders" : props.value === "unfiled" ? "No folder" : (props.folders.find((folder) => folder.id === props.value)?.name ?? "A folder");
  const tick = (value: FolderPick) => (props.value === value ? <Check size={14} aria-hidden="true" /> : undefined);

  const openMine = async () => {
    try {
      const folder = await skillsApi.ensureMyFolder(company().id);
      refresh();
      props.onPick(folder.id);
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't open your folder", body: failureText(error, "") });
    }
  };

  return (
    <>
      <Menu>
        <Menu.Trigger as={Button} size="compact" class="act-pick" classList={{ "act-pick--on": props.value !== "all" }}>
          <span class="act-pick-label">Folder:</span> <span class="act-pick-value">{current()}</span>
          <ChevronDown size={13} aria-hidden="true" />
        </Menu.Trigger>
        <Menu.Content label="Folder" width={280}>
          <Menu.Item onSelect={() => props.onPick("all")} hint={tick("all") ?? props.allCount}>
            All folders
          </Menu.Item>
          <Menu.Item onSelect={() => props.onPick("unfiled")} hint={tick("unfiled") ?? props.unfiledCount}>
            No folder
          </Menu.Item>
          <Show when={tree().length > 0}>
            <Menu.Separator />
            <For each={tree()}>
              {(folder) => (
                <Menu.Item
                  onSelect={() => props.onPick(folder.id)}
                  icon={<Folder size={14} style={{ "margin-left": `${(folder.depth - 1) * 12}px` }} />}
                  hint={tick(folder.id) ?? folder.itemCount}
                >
                  {folder.name}
                </Menu.Item>
              )}
            </For>
          </Show>
          <Menu.Separator />
          <Menu.Item onSelect={() => void openMine()} icon={<User size={14} />}>
            My folder
          </Menu.Item>
          <Menu.Item onSelect={() => setCreating(true)} icon={<FolderPlus size={14} />}>
            New folder…
          </Menu.Item>
          <Menu.Item onSelect={() => setManaging(true)} icon={<Pencil size={14} />} disabled={!props.folders.some(folderEditable)}>
            Rename or remove folders…
          </Menu.Item>
        </Menu.Content>
      </Menu>
      <FolderNameDialog
        open={creating()}
        title="New folder"
        siblings={props.folders.filter((folder) => !folder.parentId)}
        confirmLabel="Make folder"
        onClose={() => setCreating(false)}
        onSave={async (name) => {
          const folder = await skillsApi.createFolder(company().id, name, null);
          refresh();
          props.onPick(folder.id);
        }}
      />
      <ManageFoldersDialog open={managing()} folders={tree()} onClose={() => setManaging(false)} onRemoved={(id) => props.value === id && props.onPick("all")} />
    </>
  );
}

function FolderNameDialog(props: {
  open: boolean;
  title: string;
  initial?: string;
  siblings: readonly FolderListItem[];
  confirmLabel: string;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const problem = () => (name().trim() && name().trim() !== props.initial ? folderNameProblem(name(), props.siblings) : null);

  const save = async () => {
    if (folderNameProblem(name(), props.siblings) || busy()) return;
    setBusy(true);
    setError(null);
    try {
      await props.onSave(name().trim());
      props.onClose();
    } catch (caught) {
      setError(failureText(caught, "Couldn't save the folder."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (open) setName(props.initial ?? "");
        else {
          setError(null);
          props.onClose();
        }
      }}
      width={420}
      title={props.title}
      footer={
        <div class="org-dialog-foot">
          <Button variant="quiet" onClick={props.onClose} disabled={busy()}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!name().trim() || Boolean(problem()) || busy()} onClick={() => void save()}>
            {busy() ? "Saving…" : props.confirmLabel}
          </Button>
        </div>
      }
    >
      <div class="sk-form">
        <Field label="Name" for="sk-folder-name" error={problem() ?? error() ?? undefined}>
          <TextInput id="sk-folder-name" value={name()} placeholder="Research" onInput={(event) => setName(event.currentTarget.value)} onKeyDown={(event) => event.key === "Enter" && void save()} />
        </Field>
      </div>
    </Dialog>
  );
}

function ManageFoldersDialog(props: { open: boolean; folders: readonly FolderListItem[]; onClose: () => void; onRemoved: (folderId: string) => void }) {
  const company = useCompany();
  const refresh = useRefreshSkills();
  const [renaming, setRenaming] = createSignal<FolderListItem | null>(null);
  const [removing, setRemoving] = createSignal<FolderListItem | null>(null);
  const editable = () => props.folders.filter(folderEditable);

  return (
    <>
      <Dialog
        open={props.open && !renaming() && !removing()}
        onOpenChange={(open) => !open && props.onClose()}
        width={480}
        title="Folders"
        description="Your folders. Bundled skills sit in Paperclip's own folders, which can't be changed."
      >
        <Show when={editable().length > 0} fallback={<p class="org-muted">No folders of your own yet.</p>}>
          <ul class="sk-folders">
            <For each={editable()}>
              {(folder) => (
                <li>
                  <Folder size={14} aria-hidden="true" style={{ "margin-left": `${(folder.depth - 1) * 14}px` }} />
                  <span class="org-strong org-ellipsis">{folder.name}</span>
                  <span class="org-muted">{folder.itemCount === 1 ? "1 skill" : `${folder.itemCount} skills`}</span>
                  <span class="org-push sk-folder-actions">
                    <Button size="compact" variant="icon" ghost icon={<Pencil size={14} aria-hidden="true" />} aria-label={`Rename ${folder.name}`} onClick={() => setRenaming(folder)} />
                    <Button size="compact" variant="icon" ghost icon={<Trash2 size={14} aria-hidden="true" />} aria-label={`Remove ${folder.name}`} onClick={() => setRemoving(folder)} />
                  </span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Dialog>
      <FolderNameDialog
        open={renaming() !== null}
        title="Rename folder"
        initial={renaming()?.name}
        siblings={props.folders.filter((folder) => folder.parentId === renaming()?.parentId && folder.id !== renaming()?.id)}
        confirmLabel="Rename"
        onClose={() => setRenaming(null)}
        onSave={async (name) => {
          await skillsApi.renameFolder(company().id, renaming()!.id, name);
          refresh();
        }}
      />
      <ConfirmDialog
        open={removing() !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove “${removing()?.name ?? ""}”?`}
        body="Its skills stay in the library, outside this folder. Agents keep using them."
        confirmLabel="Remove folder"
        danger
        onConfirm={async () => {
          const folder = removing()!;
          try {
            await skillsApi.deleteFolder(company().id, folder.id);
            refresh();
            props.onRemoved(folder.id);
          } catch (error) {
            pushToast({ tone: "error", title: "Couldn't remove the folder", body: failureText(error, "") });
          }
        }}
      />
    </>
  );
}

/** The detail's "Folder" control: where the skill is filed, and a menu to move it. */
export function MoveToFolder(props: { skillId: string; folderId: string | null | undefined; folderPath: string | null | undefined; folders: readonly FolderListItem[] }) {
  const company = useCompany();
  const refresh = useRefreshSkills();
  const tree = createMemo(() => folderTree(props.folders));
  const name = () => props.folders.find((folder) => folder.id === props.folderId)?.name ?? props.folderPath ?? "No folder";
  const move = async (folderId: string | null) => {
    if (folderId === (props.folderId ?? null)) return;
    try {
      await skillsApi.moveToFolder(company().id, props.skillId, folderId);
      refresh(props.skillId);
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't move the skill", body: failureText(error, "") });
    }
  };
  return (
    <Menu>
      <Menu.Trigger as={Button} size="compact" variant="quiet" class="sk-move">
        <Folder size={13} aria-hidden="true" />
        <span class="org-ellipsis">{name()}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Content label="Move to folder" width={260}>
        <Menu.Item onSelect={() => void move(null)} hint={!props.folderId ? <Check size={14} aria-hidden="true" /> : undefined}>
          No folder
        </Menu.Item>
        <For each={tree()}>
          {(folder) => (
            <Menu.Item
              onSelect={() => void move(folder.id)}
              icon={<Folder size={14} style={{ "margin-left": `${(folder.depth - 1) * 12}px` }} />}
              hint={props.folderId === folder.id ? <Check size={14} aria-hidden="true" /> : undefined}
            >
              {folder.name}
            </Menu.Item>
          )}
        </For>
      </Menu.Content>
    </Menu>
  );
}
