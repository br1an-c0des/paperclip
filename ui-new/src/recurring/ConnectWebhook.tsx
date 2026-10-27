import { useQueryClient } from "@tanstack/solid-query";
import { CalendarClock, Copy, Repeat, Webhook, X } from "lucide-solid";
import { createSignal, Match, Show, Switch } from "solid-js";
import { routinesApi } from "@/api/routines";
import { useCompany } from "@/lib/company";
import { copyText } from "@/tasks/TaskActions";
import { Button } from "@/ui/Button";
import { Capsule } from "@/ui/Status";
import { Dialog } from "@/ui/Dialog";
import { TextInput } from "@/ui/Field";
import { pushToast } from "@/ui/Toast";
import { refreshRecurring, useRoutineQuery } from "./queries";
import { InfoTip } from "./RepeatMenu";
import { webhookCheck, webhookSender, webhookSetupSteps } from "./webhook";
import "./ConnectWebhook.css";

/*
 * After Create, connect the webhook (board N7): the triggers as chips, the webhook URL and its
 * secret, shown only now (the API returns it once; it can be rotated later from the recurring
 * task's panel), "Copy setup steps for an agent", and a live check for a test event (waiting,
 * received, or a signature that didn't match), read from the trigger's `lastWebhookDelivery` every
 * few seconds.
 *
 * "Turn on webhook" finishes setup (`PATCH /routine-triggers/:id { setupPending: false }`), as the
 * old trigger wizard does. "Finish later" leaves it being set up, so events only test the
 * connection until it's finished from the panel.
 */

export type ConnectTarget = {
  routineId: string;
  title: string;
  triggerId: string;
  /** From the create (or rotate) response; null when resuming setup, where it must be rotated. */
  url: string | null;
  secret: string | null;
  /** The schedule beside it, as a chip that's already on. */
  scheduleLabel?: string | null;
};

export function ConnectWebhook(props: { target: ConnectTarget; onClose: () => void; crumb?: string }) {
  const company = useCompany();
  const client = useQueryClient();
  const opened = new Date().toISOString();
  const [secret, setSecret] = createSignal(props.target.secret);
  const [url, setUrl] = createSignal(props.target.url);
  const [shown, setShown] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const routine = useRoutineQuery(() => props.target.routineId, { refetchInterval: () => 3000 });
  const trigger = () => routine.data?.triggers.find((each) => each.id === props.target.triggerId);
  const github = () => (trigger() ? webhookSender(trigger()!) === "github" : false);
  const check = () => webhookCheck(trigger(), opened);
  const webhookUrl = () => url() ?? trigger()?.webhookUrl ?? "";

  const copy = async (text: string, what: string) => {
    try {
      await copyText(text);
      pushToast({ tone: "success", title: `Copied the ${what}` });
    } catch (error) {
      pushToast({ tone: "error", title: `Couldn't copy the ${what}`, body: error instanceof Error ? error.message : undefined });
    }
  };

  const rotate = async () => {
    setBusy(true);
    try {
      const response = await routinesApi.rotateTriggerSecret(props.target.triggerId);
      setSecret(response.secretMaterial.webhookSecret);
      setUrl(response.secretMaterial.webhookUrl);
      setShown(true);
      refreshRecurring(client, company().id);
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't rotate the secret", body: error instanceof Error ? error.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    try {
      await routinesApi.updateTrigger(props.target.triggerId, { setupPending: false });
      refreshRecurring(client, company().id);
      pushToast({ tone: "success", title: "Webhook on", body: "Each event it receives now creates a task." });
      props.onClose();
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't turn on the webhook", body: error instanceof Error ? error.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  const secretTip = () =>
    `${github() ? "Paste it into GitHub's Secret field, with application/json as the content type." : "Your app signs each request with it (HMAC SHA-256), or sends it as Authorization: Bearer."} It's shown only now. If you lose it, rotate it from the recurring task's panel.`;

  return (
    <div class="cw">
      <header class="cw-head">
        <Show when={props.crumb}>
          <span class="cw-crumb">{props.crumb}</span>
          <span class="nt-slash" aria-hidden="true">
            /
          </span>
        </Show>
        <h2 class="disp cw-title">{github() ? "Connect GitHub" : "Connect your app"}</h2>
        <button type="button" class="btn btn--icon btn--ghost btn--compact cw-close" aria-label="Close and finish setup later" onClick={() => props.onClose()}>
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <div class="cw-body">
        <div class="cw-task">
          <span class="cw-task-icon" aria-hidden="true">
            <Repeat size={16} />
          </span>
          <div class="cw-task-text">
            <span class="disp cw-task-title">{props.target.title}</span>
            <ul class="cw-chips" aria-label="Triggers">
              <Show when={props.target.scheduleLabel}>
                <li class="cw-chip cw-chip--green">
                  <CalendarClock size={13} aria-hidden="true" />
                  {props.target.scheduleLabel}
                  <span>· On</span>
                </li>
              </Show>
              <li class="cw-chip cw-chip--amber">
                <Webhook size={13} aria-hidden="true" />
                {github() ? "GitHub webhook" : "Webhook"}
                <span>· {check() === "received" ? "Ready to turn on" : "Setting up"}</span>
              </li>
            </ul>
          </div>
        </div>

        <div class="cw-field">
          <label class="cw-label" for="cw-url">
            {github() ? "Payload URL" : "Webhook URL"}
          </label>
          <div class="cw-copy-row">
            <TextInput id="cw-url" class="mono" readonly value={webhookUrl()} onFocus={(event) => event.currentTarget.select()} />
            <Button size="compact" disabled={!webhookUrl()} onClick={() => void copy(webhookUrl(), "URL")}>
              <Copy size={14} aria-hidden="true" />
              Copy
            </Button>
          </div>
        </div>
        <div class="cw-field">
          <span class="cw-label-row">
            <label class="cw-label" for="cw-secret">
              Secret
            </label>
            <InfoTip text={secretTip()} label="About the secret" />
          </span>
          <Show
            when={secret()}
            fallback={
              <div class="cw-copy-row">
                <span class="cw-note">The secret was shown once, when the webhook was made. Rotate it to see a new one; the old one stops working.</span>
                <Button size="compact" disabled={busy()} onClick={() => void rotate()}>
                  Rotate secret
                </Button>
              </div>
            }
          >
            {(value) => (
              <div class="cw-copy-row">
                <TextInput id="cw-secret" class="mono" readonly value={shown() ? value() : "•".repeat(32)} />
                <Button size="compact" aria-pressed={shown()} onClick={() => setShown(!shown())}>
                  {shown() ? "Hide" : "Show"}
                </Button>
                <Button size="compact" onClick={() => void copy(value(), "secret")}>
                  <Copy size={14} aria-hidden="true" />
                  Copy
                </Button>
              </div>
            )}
          </Show>
        </div>
        <Button
          class="cw-steps"
          disabled={!secret() || !webhookUrl()}
          onClick={() =>
            void copy(
              webhookSetupSteps({ sender: github() ? "github" : "app", title: props.target.title, url: webhookUrl(), secret: secret() ?? "", setupPending: true }),
              "setup steps",
            )
          }
        >
          Copy setup steps for an agent
        </Button>

        <div class="cw-check" data-check={check()} role="status">
          <Switch>
            <Match when={check() === "waiting"}>
              <Capsule gradient="ion" size="pill" live />
              <div>
                <b>Waiting for a test event</b>
                <span>
                  {github()
                    ? "In GitHub, open the webhook's Recent Deliveries and redeliver one. Test events don't create a task."
                    : "Send one from your app, or do what should start this task. Test events don't create a task."}
                </span>
              </div>
            </Match>
            <Match when={check() === "received"}>
              <Capsule gradient="lagoon" size="pill" />
              <div>
                <b>Test event received</b>
                <span>The signature checked out. No task was created.</span>
              </div>
            </Match>
            <Match when={check() === "rejected"}>
              <Capsule gradient="flare" size="pill" />
              <div>
                <b>An event arrived, but its signature didn't match</b>
                <span>Check the secret in {github() ? "GitHub" : "your app"} and send another.</span>
              </div>
            </Match>
          </Switch>
        </div>
      </div>
      <footer class="cw-foot">
        <Button variant="quiet" ghost onClick={() => props.onClose()}>
          Finish later
        </Button>
        <InfoTip
          text={`The webhook stays off until you finish setup from the recurring task's panel.${props.target.scheduleLabel ? " The schedule is already on." : ""}`}
          label="About finishing later"
        />
        <Button variant="primary" class="cw-finish" disabled={busy()} onClick={() => void finish()}>
          {check() === "received" ? "Turn on webhook" : "Turn on without a test"}
        </Button>
      </footer>
    </div>
  );
}

/** The connect dialog on its own, for the recurring task's panel (Add trigger, or finishing setup). */
export function ConnectWebhookDialog(props: { target: ConnectTarget | null; onClose: () => void }) {
  return (
    <Dialog open={props.target !== null} onOpenChange={(open) => !open && props.onClose()} title="Connect the webhook" titleHidden hideClose width={640}>
      <Show when={props.target}>{(target) => <ConnectWebhook target={target()} onClose={props.onClose} />}</Show>
    </Dialog>
  );
}
