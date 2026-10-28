import { Check, LoaderCircle } from "lucide-solid";
import { createSignal, Match, onCleanup, Show, Switch as SwitchFlow, type JSX, type ParentProps } from "solid-js";
import { Switch } from "@/ui/Switch";
import { TonePill, type Tone } from "@/ui/Status";

/*
 * What App settings' sections share: the section title, a settings row with a switch on the right,
 * a list row (board 29's `.lrow`), a state pill, and a save runner with the small status a card shows
 * while it saves.
 */

export type SaveState = "idle" | "saving" | "saved" | "error";

export function failure(caught: unknown, fallback: string) {
  return caught instanceof Error && caught.message ? caught.message : fallback;
}

/**
 * Runs changes and tracks the latest: Saving, then Saved for a moment, or the server's error, which
 * stays until the next change. Resolves true when it worked.
 */
export function useSaver() {
  const [state, setState] = createSignal<SaveState>("idle");
  const [error, setError] = createSignal<string | null>(null);
  let latest = 0;
  let timer: number | undefined;
  onCleanup(() => window.clearTimeout(timer));
  const run = async (work: () => Promise<unknown>, fallback = "Couldn't save the change."): Promise<boolean> => {
    const id = ++latest;
    window.clearTimeout(timer);
    setState("saving");
    setError(null);
    try {
      await work();
      if (id === latest) {
        setState("saved");
        timer = window.setTimeout(() => setState("idle"), 1800);
      }
      return true;
    } catch (caught) {
      if (id === latest) {
        setState("error");
        setError(failure(caught, fallback));
      }
      return false;
    }
  };
  return { run, state, error, busy: () => state() === "saving" };
}

/** A card description with "Saving…", "Saved" or the error after it. */
export function SaveNote(props: ParentProps<{ saver: { state: () => SaveState; error: () => string | null } }>) {
  return (
    <>
      {props.children}
      <SwitchFlow>
        <Match when={props.saver.state() === "saving"}>
          <span class="as-save" role="status">
            <LoaderCircle size={13} class="as-spin" aria-hidden="true" />
            Saving…
          </span>
        </Match>
        <Match when={props.saver.state() === "saved"}>
          <span class="as-save as-save--ok" role="status">
            <Check size={13} aria-hidden="true" />
            Saved
          </span>
        </Match>
        <Match when={props.saver.state() === "error"}>
          <span class="as-save as-save--error" role="alert">
            {props.saver.error()}
          </span>
        </Match>
      </SwitchFlow>
    </>
  );
}

export function SectionTitle(props: ParentProps<{ title: string }>) {
  return (
    <div class="as-sec-title">
      <h2 class="disp">{props.title}</h2>
      <Show when={props.children}>
        <p>{props.children}</p>
      </Show>
    </div>
  );
}

/** A settings row whose control is a switch at the right. */
export function SwitchRow(props: { label: string; help?: JSX.Element; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return (
    <div class="frow as-frow-switch">
      <div class="flabel">
        {props.label}
        <Show when={props.help}>
          <span class="fhelp">{props.help}</span>
        </Show>
      </div>
      <Switch checked={props.checked} disabled={props.disabled} onChange={props.onChange} label={props.label} labelHidden />
    </div>
  );
}

/** A tinted pill for a state, or a quiet outlined one when it has no tone ("Off"). */
export function StatePill(props: { label: string; tone: Tone | null }) {
  return (
    <Show when={props.tone} fallback={<span class="as-quiet-pill">{props.label}</span>}>
      {(tone) => (
        <TonePill tone={tone()} compact>
          {props.label}
        </TonePill>
      )}
    </Show>
  );
}

/** Board 29's list row: a leading mark, a title with a mono note, a second line, and trailing controls. */
export function ListRow(
  props: ParentProps<{ mark: JSX.Element; title: JSX.Element; mono?: JSX.Element; meta?: JSX.Element; extra?: JSX.Element }>,
) {
  return (
    <div class="as-lrow">
      <span class="as-lrow-mark">{props.mark}</span>
      <div class="as-lrow-main">
        <div class="as-lrow-title">
          <span class="as-lrow-name">{props.title}</span>
          <Show when={props.mono}>
            <span class="mono as-lrow-mono">{props.mono}</span>
          </Show>
        </div>
        <Show when={props.meta}>
          <div class="as-lrow-meta">{props.meta}</div>
        </Show>
        {props.extra}
      </div>
      <div class="as-lrow-end">{props.children}</div>
    </div>
  );
}

/** A dashed note, for what isn't here yet. */
export function LaterNote(props: ParentProps<{ title: string }>) {
  return (
    <div class="as-later">
      <span class="as-later-title">{props.title}</span>
      {props.children}
    </div>
  );
}
