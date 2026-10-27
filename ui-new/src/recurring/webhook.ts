import type { RoutineTrigger } from "@paperclipai/shared";

/*
 * Webhook setup (boards N7 and R2): which app sends it, what the connection check says, and the
 * setup steps to hand an agent. The steps follow the old UI's trigger wizard
 * (ui/src/components/routine-triggers/TriggerWizard.tsx, `webhookAgentInstructions`).
 */

export type WebhookCheck = "waiting" | "received" | "rejected";

export function webhookSender(trigger: Pick<RoutineTrigger, "signingMode">): "app" | "github" {
  return trigger.signingMode === "github_hmac" ? "github" : "app";
}

/**
 * The live check while a webhook is being set up: waiting for a test event, received, or rejected
 * (the signature didn't match). A delivery from before the dialog opened doesn't count.
 */
export function webhookCheck(trigger: Pick<RoutineTrigger, "lastWebhookDelivery"> | undefined, since?: string | null): WebhookCheck {
  const delivery = trigger?.lastWebhookDelivery;
  if (!delivery) return "waiting";
  if (since && new Date(delivery.receivedAt).getTime() <= new Date(since).getTime()) return "waiting";
  return delivery.status;
}

/** A trigger's state in a few words, for its card in the panel. */
export function triggerState(trigger: Pick<RoutineTrigger, "kind" | "enabled" | "lastWebhookDelivery"> & { setupPending?: boolean }): string {
  if (trigger.setupPending) return "Setup unfinished: events only test the connection";
  if (!trigger.enabled) return "Off";
  if (trigger.kind !== "webhook") return "On";
  const delivery = trigger.lastWebhookDelivery;
  if (delivery?.status === "rejected") return "The last call's signature didn't match";
  if (delivery?.status === "received" && !delivery.test) return "Receiving events";
  return "Ready, waiting for an event";
}

export function webhookSetupSteps(input: {
  sender: "app" | "github";
  title: string;
  url: string;
  secret: string;
  /** Still being set up: deliveries only test the connection. */
  setupPending: boolean;
}): string {
  const common = [
    `Connect the sending app to the Paperclip recurring task ${JSON.stringify(input.title)}.`,
    `Webhook URL: ${input.url}`,
    "Send an HTTP POST request with a JSON object as the body (not an array or string).",
    "Content-Type: application/json",
  ];
  const auth =
    input.sender === "github"
      ? [
          "In GitHub, open your repository → Settings → Webhooks → Add webhook.",
          "Use the webhook URL above as Payload URL and select application/json as Content type.",
          `Secret: ${input.secret}`,
          "Paste this value into GitHub's Secret field. GitHub signs requests with X-Hub-Signature-256; do not use Bearer authentication.",
          "Select the events that should start this task, enable the webhook, and save.",
          "To check the connection, open Recent Deliveries and redeliver an event.",
        ]
      : [
          `Secret key: ${input.secret}`,
          "If the app asks for a signing secret, paste the secret key above. Paperclip accepts HMAC-SHA256 over the exact request body in X-Hub-Signature or X-Hub-Signature-256, formatted sha256=<hex digest>.",
          `For apps with custom headers, use Authorization: Bearer ${input.secret}`,
          "Subscribe only to the events that should start this task. Public services need a publicly reachable HTTPS URL.",
          "Send a unique Idempotency-Key header for each event and reuse it on retries.",
          'Example JSON body: {"event":"deployment.completed","environment":"production"}',
          "Fields in the JSON fill the task's placeholders of the same name.",
        ];
  return [
    ...common,
    ...auth,
    ...(input.setupPending
      ? [
          "During setup, deliveries only test the connection. They do not create a task.",
          "Finish setup in Paperclip to turn the webhook on. Test events are not replayed.",
        ]
      : ["This webhook is on. Deliveries create tasks."]),
    "Store the secret securely; do not put it in source control or logs.",
  ].join("\n");
}
