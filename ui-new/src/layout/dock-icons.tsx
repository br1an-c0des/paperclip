/* The dock's icons, drawn as on the N1 board (design/mobile/NavDock.dc.html). */

export function InboxIcon() {
  return (
    <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  );
}

export function TasksIcon(props: { size?: number }) {
  return (
    <svg aria-hidden="true" width={props.size ?? 19} height={props.size ?? 19} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="4" width="18" height="7" rx="3.5" />
      <rect x="3" y="13" width="18" height="7" rx="3.5" />
    </svg>
  );
}

/** Status cards: the nav's radar, at the dock's weight. */
export function StatusIcon() {
  return (
    <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M19.07 4.93A10 10 0 0 0 6.99 3.34" />
      <path d="M4 6h.01" />
      <path d="M2.29 9.62A10 10 0 1 0 21.31 8.35" />
      <path d="M16.24 7.76A6 6 0 1 0 8.23 16.67" />
      <path d="M12 18h.01" />
      <path d="M17.99 11.66A6 6 0 0 1 15.77 16.67" />
      <circle cx="12" cy="12" r="2" />
      <path d="m13.41 10.59 5.66-5.66" />
    </svg>
  );
}

export function AgentsIcon() {
  return (
    <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M5 20v-8a7 7 0 0 1 14 0v8z" />
      <path d="M9.5 13h.01M14.5 13h.01" />
    </svg>
  );
}
