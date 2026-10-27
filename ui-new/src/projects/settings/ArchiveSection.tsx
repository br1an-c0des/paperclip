import type { Project } from "@paperclipai/shared";
import { createSignal, Show } from "solid-js";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { SettingsCard } from "@/ui/Field";
import { pushToast } from "@/ui/Toast";
import { useMembership } from "./AccessSection";
import { archivePatch } from "./settings-model";
import { FootError, useProjectSaver } from "./shared";

/*
 * Archive (board 10, `section` = archive): archiving hides the project from the sidebar and project
 * lists; its tasks keep it and stay findable in filters (`PATCH /projects/:id { archivedAt }`).
 * It asks first, and can be undone here or from the toast. Leaving is personal and sits here too,
 * as on the board.
 */

export function ArchiveSection(props: { project: Project }) {
  const saver = useProjectSaver(() => props.project);
  const membership = useMembership(() => props.project);
  const [confirm, setConfirm] = createSignal(false);
  const archived = () => Boolean(props.project.archivedAt);

  const setArchived = async (archive: boolean) => {
    setConfirm(false);
    const name = props.project.name;
    if (await saver.save(archivePatch(archive))) {
      pushToast({
        tone: "success",
        title: archive ? `Archived ${name}` : `Restored ${name}`,
        action: archive ? { label: "Undo", onClick: () => void saver.save(archivePatch(false)) } : undefined,
      });
    }
  };

  return (
    <>
      <SettingsCard title="Archive" aria-label="Archive">
        <div class="ps-danger">
          <div class="ps-danger-row">
            <div>
              <div class="ps-danger-title">{archived() ? "This project is archived" : "Archive project"}</div>
              <p class="ps-muted-line">
                {archived()
                  ? "It's hidden from the sidebar and project lists. Its tasks keep the project. Restore it to bring it back."
                  : "Hides it from the sidebar and project lists. Its tasks keep the project and stay findable in filters. You can restore it later."}
              </p>
            </div>
            <Show
              when={archived()}
              fallback={
                <Button size="compact" variant="danger" disabled={saver.state() === "saving"} onClick={() => setConfirm(true)}>
                  Archive project
                </Button>
              }
            >
              <Button size="compact" disabled={saver.state() === "saving"} onClick={() => void setArchived(false)}>
                {saver.state() === "saving" ? "Restoring…" : "Restore project"}
              </Button>
            </Show>
          </div>
          <div class="ps-danger-row">
            <div>
              <div class="ps-danger-title">{membership.state() === "left" ? "Join project" : "Leave project"}</div>
              <p class="ps-muted-line">
                {membership.state() === "left" ? "Puts it back in your sidebar." : "Removes it from your sidebar. Other members aren't affected."}
              </p>
            </div>
            <Button size="compact" disabled={!membership.loaded() || membership.pending()} onClick={() => membership.set({ state: membership.state() === "left" ? "joined" : "left" })}>
              {membership.state() === "left" ? "Join" : "Leave"}
            </Button>
          </div>
          <Show when={saver.state() === "error"}>
            <div class="ps-danger-row">
              <FootError message={saver.error()} />
            </div>
          </Show>
        </div>
      </SettingsCard>
      <Dialog
        open={confirm()}
        onOpenChange={setConfirm}
        title={`Archive ${props.project.name}?`}
        width={460}
        description="It disappears from the sidebar and the project lists. Its tasks keep the project, and you can restore it from here."
        footer={
          <>
            <Button variant="quiet" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void setArchived(true)}>
              Archive project
            </Button>
          </>
        }
      />
    </>
  );
}
