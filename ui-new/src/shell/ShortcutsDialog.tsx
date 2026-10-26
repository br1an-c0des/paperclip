import { For } from "solid-js";
import { useCommands } from "@/lib/commands";
import { SHORTCUT_GROUPS } from "@/lib/shortcuts";
import { Dialog } from "@/ui/Dialog";
import "./CommandPalette.css";

/* The keyboard shortcuts cheatsheet (`?`), after ui/src/components/KeyboardShortcutsCheatsheet.tsx. */
export function ShortcutsDialog() {
  const commands = useCommands();
  return (
    <Dialog open={commands.shortcutsOpen()} onOpenChange={commands.setShortcutsOpen} title="Keyboard shortcuts" width={620}>
      <div class="shortcuts">
        <For each={SHORTCUT_GROUPS}>
          {(group) => (
            <section>
              <h3>{group.title}</h3>
              <dl>
                <For each={group.items}>
                  {(item) => (
                    <div>
                      <dt>{item.label}</dt>
                      <dd>
                        <For each={item.keys}>{(key) => <kbd>{key}</kbd>}</For>
                      </dd>
                    </div>
                  )}
                </For>
              </dl>
            </section>
          )}
        </For>
      </div>
    </Dialog>
  );
}
