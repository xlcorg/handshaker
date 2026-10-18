/** Px of overflow we tolerate before showing the minimap. A 1px overflow as the
 *  layout settles (or a horizontal scrollbar appearing) shouldn't toggle the
 *  strip on and off. */
export const MINIMAP_OVERFLOW_TOLERANCE = 8;

/** Show the response minimap only when the rendered content overflows the
 *  viewport — a short response (or a tall pane) keeps a clean, strip-free editor. */
export function shouldShowMinimap(
  contentHeight: number,
  viewportHeight: number,
  tolerance = MINIMAP_OVERFLOW_TOLERANCE,
): boolean {
  return contentHeight > viewportHeight + tolerance;
}
