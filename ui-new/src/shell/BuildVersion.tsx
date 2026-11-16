import { Tooltip as KTooltip } from "@kobalte/core/tooltip";
import { createQuery } from "@tanstack/solid-query";
import { createSignal, createUniqueId, Show } from "solid-js";
import { healthApi } from "@/api/health";
import { queryKeys } from "@/api/queryKeys";
import { useLayerMount } from "@/ui/layer";
import { buildVersion, formatBuiltAt } from "./build-version";
import "@/ui/Tooltip.css";
import "./BuildVersion.css";

/*
 * Which build you're looking at: a small muted line, "ui 1a2b3c4 · server 5d6e7f8", under You in
 * the full nav and at the foot of the rail's You menu and the phone's You sheet. Its tooltip holds
 * the full commits and when the UI was built. Like InfoTip, it opens on hover and focus, and a tap
 * or click pins it open (its text isn't shown anywhere else, decision H).
 *
 * The server's commit is `GET /api/health`'s `commit`, from the query the session gate already
 * keeps (lib/session.tsx), so this adds no request; it's left out when health has none.
 */

export function BuildVersion(props: { class?: string; placement?: "top" | "bottom" | "left" | "right" }) {
  const health = createQuery(() => ({
    queryKey: queryKeys.health,
    queryFn: healthApi.get,
    retry: false,
    staleTime: Infinity,
  }));
  const version = () => buildVersion({ uiCommit: __UI_COMMIT__, uiBuiltAt: __UI_BUILT_AT__, serverCommit: health.data?.commit });
  const mount = useLayerMount();
  const descriptionId = createUniqueId();
  const [open, setOpen] = createSignal(false);
  let pinned = false;
  let trigger: HTMLButtonElement | undefined;
  const unpin = () => {
    pinned = false;
  };

  const details = () => (
    <>
      <b>Build</b>
      <span class="buildv-row">
        <span>UI commit</span>
        <code>{version().ui ?? "Unknown"}</code>
      </span>
      <Show when={version().server}>
        {(server) => (
          <span class="buildv-row">
            <span>Server commit</span>
            <code>{server()}</code>
          </span>
        )}
      </Show>
      <span class="buildv-row">
        <span>UI built</span>
        <Show when={version().builtAt} fallback={<span>Unknown</span>}>
          {(at) => <time dateTime={at()}>{formatBuiltAt(at())}</time>}
        </Show>
      </span>
    </>
  );

  return (
    <KTooltip
      open={open()}
      onOpenChange={(next) => {
        if (next || !pinned) setOpen(next);
      }}
      openDelay={300}
      closeDelay={80}
      gutter={6}
      placement={props.placement ?? "top"}
    >
      <KTooltip.Trigger
        ref={trigger}
        type="button"
        class={`buildv ${props.class ?? ""}`}
        aria-label={`Build: ${version().line}`}
        aria-describedby={descriptionId}
        onClick={(event: MouseEvent) => {
          event.preventDefault();
          event.stopPropagation();
          pinned = !pinned;
          setOpen(pinned);
        }}
        onPointerDown={(event: PointerEvent) => event.stopPropagation()}
        onKeyDown={(event: KeyboardEvent) => {
          // Inside a menu, Enter and Space would choose the focused item; here they pin the tip.
          if (event.key === "Enter" || event.key === " ") event.stopPropagation();
        }}
        onBlur={unpin}
      >
        {version().line}
      </KTooltip.Trigger>
      <span id={descriptionId} hidden>
        {details()}
      </span>
      <KTooltip.Portal mount={mount()}>
        <KTooltip.Content
          class="tip buildv-tip"
          aria-hidden="true"
          onPointerDownOutside={(event: Event) => {
            if (trigger?.contains(event.target as Node)) event.preventDefault();
            else unpin();
          }}
          onEscapeKeyDown={unpin}
        >
          {details()}
        </KTooltip.Content>
      </KTooltip.Portal>
    </KTooltip>
  );
}
