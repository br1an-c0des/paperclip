import { createComputed, createSignal, onCleanup, untrack, type Accessor } from "solid-js";

/*
 * One ticking clock for everything that shows a live time: running times, countdowns, "2s ago".
 *
 * `useNow()` returns the current time (ms since the epoch) as an accessor that changes every second.
 * All subscribers share one interval: it starts with the first subscriber and stops when the last
 * one is cleaned up. While the tab is hidden it doesn't tick, and it catches up at once when the tab
 * comes back.
 *
 *   const now = useNow(() => run().status === "running");
 *   <span>{duration(run().startedAt, new Date(now()))}</span>
 */

const TICK_MS = 1_000;

const [tick, setTick] = createSignal(Date.now());
let subscribers = 0;
let timer: number | undefined;

function hidden() {
  return document.visibilityState === "hidden";
}

function startTimer() {
  setTick(Date.now());
  if (timer !== undefined || hidden()) return;
  timer = window.setInterval(() => setTick(Date.now()), TICK_MS);
}

function stopTimer() {
  window.clearInterval(timer);
  timer = undefined;
}

function onVisibility() {
  if (hidden()) stopTimer();
  else startTimer();
}

function subscribe() {
  subscribers += 1;
  if (subscribers > 1) return;
  document.addEventListener("visibilitychange", onVisibility);
  startTimer();
}

function unsubscribe() {
  subscribers = Math.max(0, subscribers - 1);
  if (subscribers > 0) return;
  document.removeEventListener("visibilitychange", onVisibility);
  stopTimer();
}

/**
 * The current time in ms, ticking every second while `active` is true (always, when it's left out).
 *
 * Call it in a component (or another reactive owner): it subscribes to the shared clock at once and
 * unsubscribes when the owner is cleaned up or `active` turns false. While inactive the accessor
 * still answers with the current time when it's read, but doesn't make anything re-run on its own,
 * so a finished run's labels stay put.
 */
export function useNow(active: () => boolean = () => true): Accessor<number> {
  // A computed rather than an effect, so the clock is already running when the view first reads it.
  createComputed(() => {
    if (!active()) return;
    untrack(subscribe);
    onCleanup(unsubscribe);
  });
  // An inactive reader gets the time as of the read, untracked.
  return () => (active() ? tick() : Date.now());
}

/** How many subscribers the clock has, and whether it's ticking. For tests. */
export function clockState() {
  return { subscribers, ticking: timer !== undefined };
}
