/*
 * Grain: a noise texture laid over gradient capsules and discs. The `#grain` filter is defined once
 * per page by <GrainFilter> (in App.tsx); each <Grain> references it. The parent needs
 * `position: relative; overflow: hidden` (the `.grained` class). Hidden under `.no-grain`.
 */

export function GrainFilter() {
  return (
    <svg aria-hidden="true" width="0" height="0" style={{ position: "absolute" }}>
      <filter id="grain">
        <feTurbulence type="fractalNoise" baseFrequency="0.88" numOctaves="2" stitchTiles="stitch" />
        <feColorMatrix type="saturate" values="0" />
      </filter>
    </svg>
  );
}

export function Grain() {
  return (
    <svg class="grain" aria-hidden="true">
      <rect width="100%" height="100%" filter="url(#grain)" />
    </svg>
  );
}
