import { Bookmark, ChevronDown, Trash2 } from "lucide-solid";
import { createSignal, For, Show } from "solid-js";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Field, TextInput } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import type { SavedView } from "./saved-views";
import "./SavedViews.css";

/*
 * The task list's Views menu: the list's saved views (saved-views.ts) to switch between, saving the
 * current grouping, filters, sort and search as a new one, updating the picked view once the
 * settings have moved on from it, and a dialog to rename or delete views.
 */

export function SavedViewsMenu(props: {
  views: readonly SavedView[];
  /** The saved view the list shows now, if its settings still match one. */
  current: SavedView | undefined;
  /** The view last picked, when the settings have changed since. */
  edited: SavedView | undefined;
  onPick: (view: SavedView) => void;
  onSave: (name: string) => void;
  onUpdate: (view: SavedView) => void;
  onRename: (view: SavedView, name: string) => void;
  onDelete: (view: SavedView) => void;
}) {
  const [saving, setSaving] = createSignal(false);
  const [managing, setManaging] = createSignal(false);
  const label = () => props.current?.name ?? (props.edited ? `${props.edited.name} (edited)` : "Views");

  return (
    <>
      <Menu>
        <Menu.Trigger as={Button} classList={{ "tv-filter--on": !!props.current }} aria-label={`Saved views: ${label()}`}>
          <Bookmark size={14} aria-hidden="true" fill={props.current ? "currentColor" : "none"} />
          <span class="sv-label">{label()}</span>
          <ChevronDown size={12} stroke-width={2} aria-hidden="true" class="tv-caret" />
        </Menu.Trigger>
        <Menu.Content label="Saved views" width={260}>
          <Menu.Group label="Saved views">
            <For each={props.views} fallback={<Menu.Item disabled>No saved views yet</Menu.Item>}>
              {(view) => (
                <Menu.Item hint={props.current?.id === view.id ? "✓" : undefined} onSelect={() => props.onPick(view)}>
                  {view.name}
                </Menu.Item>
              )}
            </For>
          </Menu.Group>
          <Menu.Separator />
          <Show when={props.edited}>
            {(view) => <Menu.Item onSelect={() => props.onUpdate(view())}>Update “{view().name}”</Menu.Item>}
          </Show>
          <Menu.Item onSelect={() => setSaving(true)}>Save as a new view…</Menu.Item>
          <Show when={props.views.length > 0}>
            <Menu.Item onSelect={() => setManaging(true)}>Rename or delete views…</Menu.Item>
          </Show>
        </Menu.Content>
      </Menu>
      <SaveViewDialog open={saving()} onOpenChange={setSaving} onSave={props.onSave} />
      <ManageViewsDialog
        open={managing()}
        onOpenChange={setManaging}
        views={props.views}
        onRename={props.onRename}
        onDelete={props.onDelete}
      />
    </>
  );
}

function SaveViewDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; onSave: (name: string) => void }) {
  let input: HTMLInputElement | undefined;
  const [name, setName] = createSignal("");
  const save = (event?: Event) => {
    event?.preventDefault();
    if (!name().trim()) return;
    props.onSave(name().trim());
    setName("");
    props.onOpenChange(false);
  };
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) setName("");
        props.onOpenChange(open);
      }}
      title="Save view"
      description="Keeps this list's grouping, filters, sort and search under a name, in this browser."
      width={440}
      hideClose
      initialFocus={() => input}
      footer={
        <>
          <Button variant="quiet" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => save()} disabled={!name().trim()}>
            Save view
          </Button>
        </>
      }
    >
      <form onSubmit={save}>
        <Field label="Name" for="sv-name">
          <TextInput
            id="sv-name"
            ref={input}
            value={name()}
            onInput={(event) => setName(event.currentTarget.value)}
            placeholder="Blocked on agents"
            autocomplete="off"
          />
        </Field>
      </form>
    </Dialog>
  );
}

function ManageViewsDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  views: readonly SavedView[];
  onRename: (view: SavedView, name: string) => void;
  onDelete: (view: SavedView) => void;
}) {
  // A name is saved when its field loses focus or Enter is pressed; an empty one goes back. Rows are
  // keyed by id and read the view afresh, so a rename doesn't remount the row (which swallowed the
  // next click) and a late blur compares against the name as it is now.
  const byId = (id: string) => props.views.find((view) => view.id === id);
  const commit = (id: string, input: HTMLInputElement) => {
    const view = byId(id);
    if (!view) return;
    const name = input.value.trim();
    if (!name) input.value = view.name;
    else if (name !== view.name) props.onRename(view, name);
  };
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="Saved views"
      width={480}
      footer={
        <Button variant="primary" onClick={() => props.onOpenChange(false)}>
          Done
        </Button>
      }
    >
      <ul class="sv-list">
        <For each={props.views.map((view) => view.id)} fallback={<li class="muted">No saved views.</li>}>
          {(id) => {
            const name = () => byId(id)?.name ?? "";
            return (
              <li class="sv-row">
                <TextInput
                  value={name()}
                  aria-label={`Name of the view ${name()}`}
                  onBlur={(event) => commit(id, event.currentTarget)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    commit(id, event.currentTarget);
                  }}
                />
                <Button
                  variant="icon"
                  ghost
                  size="compact"
                  aria-label={`Delete the view ${name()}`}
                  onClick={() => {
                    const view = byId(id);
                    if (view) props.onDelete(view);
                  }}
                >
                  <Trash2 size={15} aria-hidden="true" />
                </Button>
              </li>
            );
          }}
        </For>
      </ul>
    </Dialog>
  );
}
