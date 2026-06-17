/**
 * Animation timings for the card deal and dealer reveal.
 *
 * These values are global — every player sees the same animation. To retune,
 * edit the numbers here and save.
 *
 * The server's `Config.DEALING_DURATION_MS` must be >= the longest possible
 * client deal animation: `(nonEmptyPlayerCount + 1) * DEAL_CARD_INTERVAL_MS + CARD_ENTRY_DURATION_S`.
 * Both constants are cross-referenced in comments; update them together.
 *
 * `prefers-reduced-motion: reduce` short-circuits all of these
 * (see `usePrefersReducedMotion` and the `<MotionConfig reducedMotion="user">`
 * wrapper in `TableView`).
 */

/** How long each card takes to scale in during the initial deal. */
export const DEAL_CARD_INTERVAL_MS = 250;

/** How long each dealer card takes to flip in during the dealer reveal. */
export const DEALER_REVEAL_CARD_INTERVAL_MS = 500;

/** Per-card entry transition (the scale 0→1 framer-motion tween). */
export const CARD_ENTRY_DURATION_S = 0.25;

/** 3D rotateY duration for the dealer's hole card flip on reveal. */
export const HOLE_CARD_FLIP_DURATION_S = 0.6;

/**
 * Round-robin stagger: the Nth non-empty seat starts dealing `pos * interval`
 * ms after the first. Dealer is `pos = nonEmptyPlayerCount`.
 */
export function dealPositionToStartDelayMs(dealPosition: number): number {
  return dealPosition * DEAL_CARD_INTERVAL_MS;
}
