import type {
  BrowserUseViewportPreset,
  EmailDeliveryOutcome,
  EmailMessage,
  EmailPublicationSummary,
  EmailThreadSummary,
  ExternalChannelBindingSummary,
  TaskBrowser,
} from "@paperclipai/shared";

/*
 * What a task carries from outside Paperclip (src/tasks/integrations/): the chat conversation it's
 * bound to, its email thread, and the browsers its agent opened. The old UI's pieces are
 * ExternallyConnectedTaskBanner, EmailTaskActivity/EmailMessageCard and TaskBrowserPanel.
 */

/** Chat tasks (`chat:…` ids) are the assistant's; they have none of these. */
export function isTaskId(taskId: string) {
  return Boolean(taskId) && !taskId.startsWith("chat:");
}

/** Bindings the board can send to: voice calls and email have their own pieces. */
export function canSendToBinding(binding: Pick<ExternalChannelBindingSummary, "provider"> | null | undefined) {
  return Boolean(binding && binding.provider !== "speko" && binding.provider !== "agentmail");
}

// --- Email ---

const DELIVERY_LABELS: Record<EmailDeliveryOutcome, string> = {
  queued: "Queued",
  sent: "Sent",
  delivered: "Delivered",
  failed: "Delivery failed",
  uncertain: "Delivery not confirmed",
};

export function deliveryLabel(outcome: EmailDeliveryOutcome) {
  return DELIVERY_LABELS[outcome] ?? outcome;
}

/** The delivery a message went out as, matched by the provider's message id. */
export function deliveryFor(thread: Pick<EmailThreadSummary, "publications">, message: Pick<EmailMessage, "providerMessageId">) {
  return thread.publications.find((publication) => publication.providerMessageId === message.providerMessageId) ?? null;
}

/**
 * Sends that aren't a message in the thread yet (as the old UI's EmailTaskActivity): ones Paperclip
 * has no message id for (queued, failed, or lost track of), and uncertain ones.
 */
export function openDeliveries(thread: Pick<EmailThreadSummary, "publications"> | null | undefined): EmailPublicationSummary[] {
  return (thread?.publications ?? []).filter((publication) => !publication.providerMessageId || publication.outcome === "uncertain");
}

/** Of those, the ones someone has to look at: failed, or uncertain (only these can be resolved). */
export function deliveriesNeedingAttention(thread: Pick<EmailThreadSummary, "publications"> | null | undefined): EmailPublicationSummary[] {
  return openDeliveries(thread).filter((publication) => publication.outcome === "uncertain" || publication.outcome === "failed");
}

export function canResolveDelivery(publication: Pick<EmailPublicationSummary, "outcome">) {
  return publication.outcome === "uncertain";
}

/** Messages that haven't become a task comment yet (the rest already read in the thread). */
export function uncommentedMessages(thread: Pick<EmailThreadSummary, "messages"> | null | undefined) {
  return (thread?.messages ?? []).filter((message) => !message.commentId);
}

export function inboxToggle(status: string): "pause" | "resume" | null {
  return status === "active" ? "pause" : status === "paused" ? "resume" : null;
}

export function threadSummary(thread: Pick<EmailThreadSummary, "messages" | "endpoint">) {
  const count = thread.messages.length;
  const messages = `${count} ${count === 1 ? "message" : "messages"}`;
  return thread.endpoint.address ? `${messages} · ${thread.endpoint.address}` : messages;
}

// --- Browsers ---

/** Remote window sizes (shared's BROWSER_USE_VIEWPORT_PRESETS, a runtime value). */
export const VIEWPORT_PRESETS = [
  { id: "phone", label: "Phone", width: 390, height: 844 },
  { id: "tablet", label: "Tablet", width: 768, height: 1024 },
  { id: "laptop", label: "Laptop", width: 1280, height: 800 },
  { id: "desktop", label: "Desktop", width: 1440, height: 900 },
] as const satisfies readonly { id: BrowserUseViewportPreset; label: string; width: number; height: number }[];

export const SIZE_OPTIONS: { value: BrowserUseViewportPreset; label: string }[] = [
  { value: "fit", label: "Fit" },
  ...VIEWPORT_PRESETS.map((preset) => ({ value: preset.id, label: preset.label })),
];

const OPEN = new Set<TaskBrowser["status"]>(["starting", "running", "idle", "stopping"]);

/** The browser to show: the newest one still open. */
export function currentBrowser(browsers: readonly TaskBrowser[] | null | undefined): TaskBrowser | null {
  const open = (browsers ?? []).filter((browser) => OPEN.has(browser.status));
  return open.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

export function isViewable(browser: Pick<TaskBrowser, "status"> | null | undefined) {
  return browser?.status === "running" || browser?.status === "idle";
}

export function browserHeadline(browser: Pick<TaskBrowser, "status">) {
  switch (browser.status) {
    case "starting":
      return "Starting a browser…";
    case "running":
      return "The agent is browsing";
    case "idle":
      return "Browser open, idle";
    case "stopping":
      return "Closing the browser…";
    case "failed":
      return "The browser couldn't start";
    default:
      return "Browser closed";
  }
}

/** "Closes in 4:05" for an idle browser, or null. */
export function idleCountdown(browser: Pick<TaskBrowser, "status" | "idleDeadline">, now: number) {
  if (browser.status !== "idle" || !browser.idleDeadline) return null;
  const left = Math.max(0, Math.round((Date.parse(browser.idleDeadline) - now) / 1000));
  return `Closes in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}

export function costText(cents: number) {
  return cents > 0 ? `$${(cents / 100).toFixed(2)}` : null;
}

/** A pane's size for `fit`, scaled down (keeping its shape) to the provider's bounds. */
export function paneSize(width: number, height: number) {
  if (width < 1 || height < 1) return null;
  const scale = Math.min(1, 6144 / width, 3456 / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Whether the pane changed by at least two pixels either way since it was last measured. */
export function resizedEnough(last: { width: number; height: number } | null, next: { width: number; height: number }) {
  return !last || Math.abs(next.width - last.width) >= 2 || Math.abs(next.height - last.height) >= 2;
}
