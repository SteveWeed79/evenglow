/**
 * Hand-drawn marks — UX-SPEC §6, warmth #2.
 *
 * "Inline SVG line drawings, one per empty state — a nesting box, a hung
 * lantern, a grease gun on a bench. Single-weight strokes in `--muted`, under
 * 2KB each, never full-bleed, never animated."
 *
 * Inline rather than a file or an icon package: they inherit `currentColor`,
 * so they follow lamplight and bright-sun mode without a second asset, and
 * they cost no request on a device with no signal.
 *
 * Everything here is a single stroke weight and no fills. That is what makes a
 * set of drawings by different hands look like one hand.
 */

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/** Tab icons — 24px, drawn on a 24 grid. */
export function TodayMark(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" {...STROKE}>
      {/* Sun over the horizon — the hour this app is opened. */}
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3.5v2M12 18.5v2M4.2 12h2M17.8 12h2M6.5 6.5l1.4 1.4M16.1 16.1l1.4 1.4M17.5 6.5l-1.4 1.4M7.9 16.1l-1.4 1.4" />
    </svg>
  );
}

export function StockMark(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" {...STROKE}>
      {/* A hen: comb, head, beak, body, tail, legs. */}
      <path d="M14.5 5.2c.5-.9 1.6-.9 2 0 .5-.8 1.5-.6 1.7.3" />
      <path d="M16.8 6.2a2.1 2.1 0 0 0-2.1 2.1c0 .5.2 1 .5 1.4" />
      <path d="M14.2 8.6 12.4 9.7l1.8.7" />
      <path d="M15.2 9.7c-3.6.4-6.4 2.6-6.4 5.6 0 2.2 1.9 3.9 4.6 3.9 3 0 5.4-2 5.4-5 0-1.9-1-3.4-2.6-4.2" />
      <path d="M8.8 13.6C7.4 12.8 5.6 12.9 4.6 14c1 .2 1.6.8 1.8 1.6" />
      <path d="M11.4 19.2v1.4M15.6 19.2v1.4" />
    </svg>
  );
}

export function IronMark(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" {...STROKE}>
      {/* A tractor in profile: big rear wheel, small front, body, stack. */}
      <circle cx="7.5" cy="16.5" r="3.6" />
      <circle cx="18" cy="17.5" r="2.6" />
      <path d="M4.4 13.6V9.4h4.8l1.6 3.2h4.4v4.9" />
      <path d="M10.8 12.6h4.6" />
      <path d="M6 9.4V6.2h1.8v3.2" />
      <path d="M15.4 17.5h-4.3" />
    </svg>
  );
}

export function MoreMark(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" {...STROKE}>
      {/* A shelf of jars — the pantry, where the things you use less often live. */}
      <path d="M3.5 19.5h17" />
      <path d="M6 19.5v-5.2a1 1 0 0 1 1-1h2.2a1 1 0 0 1 1 1v5.2" />
      <path d="M7 13.3v-1.1h2.2v1.1" />
      <path d="M13.6 19.5v-7.6a1 1 0 0 1 1-1h2.4a1 1 0 0 1 1 1v7.6" />
      <path d="M14.8 10.9V9.6h2.4v1.3" />
      <path d="M6 16.2h4.2M13.6 15.4h4.8" />
    </svg>
  );
}

/**
 * Empty-state spots — larger, one per screen, never full-bleed.
 *
 * The rule from §6 is that charm goes where the app is *waiting*. An empty
 * screen is the app waiting by definition, which is why this is the one place
 * a drawing earns its place.
 */
export function BasketSpot(): React.ReactElement {
  return (
    <svg viewBox="0 0 64 48" width="88" height="66" aria-hidden="true" {...STROKE}>
      {/* A basket with three eggs — nothing gathered yet. */}
      <path d="M14 22h36l-3.4 18.5a3 3 0 0 1-3 2.5H20.4a3 3 0 0 1-3-2.5z" />
      <path d="M14 22c0-7.2 8-13 18-13s18 5.8 18 13" />
      <path d="M20.5 27.5 23 41M32 27.5V41M43.5 27.5 41 41" />
      <ellipse cx="24" cy="18.5" rx="3.6" ry="4.4" />
      <ellipse cx="32" cy="16.5" rx="3.6" ry="4.4" />
      <ellipse cx="40" cy="18.5" rx="3.6" ry="4.4" />
    </svg>
  );
}

export function NestBoxSpot(): React.ReactElement {
  return (
    <svg viewBox="0 0 64 48" width="88" height="66" aria-hidden="true" {...STROKE}>
      {/* A nesting box with its perch, waiting to be filled. */}
      <path d="M11 20.5 32 7l21 13.5" />
      <path d="M14.5 20.5V42h35V20.5" />
      <circle cx="32" cy="28" r="6.2" />
      <path d="M22 42v-6M42 42v-6" />
      <path d="M14.5 36.5h35" />
      <path d="M9 36.5h5.5M49.5 36.5H55" />
    </svg>
  );
}

export function OilCanSpot(): React.ReactElement {
  return (
    <svg viewBox="0 0 64 48" width="88" height="66" aria-hidden="true" {...STROKE}>
      {/* An oil can on a bench — the shed half of the farm. */}
      <path d="M18 42h26a3 3 0 0 0 3-3V26a3 3 0 0 0-3-3H18a3 3 0 0 0-3 3v13a3 3 0 0 0 3 3z" />
      <path d="M47 28.5 58 22" />
      <path d="M22 23v-3.5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2V23" />
      <path d="M15 32h32" />
      <path d="M8 45.5h48" />
      <path d="M26 30.5h9" />
    </svg>
  );
}
