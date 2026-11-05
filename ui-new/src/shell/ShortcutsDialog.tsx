import { For } from "solid-js";
import { useCommands } from "@/lib/commands";
import { useExperimentalSettingsQuery } from "@/lib/company-data";
import { shortcutGroups } from "@/lib/shortcuts";
import { submitKeyFor } from "@/tasks/composer/submit-key";
import { Dialog } from "@/ui/Dialog";
import "./CommandPalette.css";

/*
 * The keyboard shortcuts cheatsheet (`?`), after ui/src/components/KeyboardShortcutsCheatsheet.tsx.
 * The task composer's send keys show the mode the instance uses, once its settings have loaded.
 */
export function ShortcutsDialog() {
  const commands = useCommands();
  const settings = useExperimentalSettingsQuery();
  const groups = () => shortcutGroups(settings.data ? submitKeyFor(settings.data) : null);
  return (
    <Dialog open={commands.shortcutsOpen()} onOpenChange={commands.setShortcutsOpen} title="Keyboard shortcuts" width={620}>
      <div class="shortcuts">
        <For each={groups()}>
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
