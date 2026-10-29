import type { SourceTrustMetadata } from "@paperclipai/shared";
import { BadgeCheck, ShieldAlert } from "lucide-solid";
import { Show } from "solid-js";
import { sourceTrustBadge } from "./document-model";
import "./MarkdownEditor.css";

/*
 * "Low-trust source" on a document or comment a low-trust review agent wrote, or "Promoted from low
 * trust" once someone promoted it (the old UI's SourceTrustBadge). Nothing for everything else.
 */

export function SourceTrustBadge(props: { sourceTrust: SourceTrustMetadata | null | undefined }) {
  const badge = () => sourceTrustBadge(props.sourceTrust);
  return (
    <Show when={badge()}>
      {(found) => (
        <span class="trust-badge" data-promoted={found().promoted ? "" : undefined} title={found().description} aria-label={found().label}>
          <Show when={found().promoted} fallback={<ShieldAlert size={11} aria-hidden="true" />}>
            <BadgeCheck size={11} aria-hidden="true" />
          </Show>
          {found().label}
        </span>
      )}
    </Show>
  );
}
