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

/**
 * Coupled minimap + vertical-scrollbar options for the response editor's size
 * gate. The minimap and the vertical scrollbar are TWO position indicators on
 * the same right edge — showing both reads as two parallel bars. So they toggle
 * together: when the minimap shows, it becomes the sole vertical navigator
 * (`showSlider:"always"` pins the viewport rectangle so position is visible
 * without hovering), and the redundant vertical scrollbar is hidden. When the
 * minimap hides (short response / the 8px gate band), the scrollbar returns as
 * the only affordance. The horizontal scrollbar is unaffected — word-wrap is off
 * by default, so long values still need it, and the minimap can't scroll sideways.
 *
 * The full scrollbar object is re-specified in BOTH states because
 * `editor.updateOptions` replaces the scrollbar option rather than merging it —
 * an unspecified field would fall back to a Monaco default. The horizontal fields
 * stay in sync with `EDITOR_OPTIONS.scrollbar` in monaco.ts.
 *
 * `verticalScrollbarSize` differs by state on purpose: Monaco reserves that many
 * px at the right edge for the vertical scrollbar even when it's `vertical:"hidden"`
 * (its layout positions a right-side minimap at `outerWidth - minimapWidth -
 * verticalScrollbarSize`). Hiding the scrollbar alone therefore leaves a blank band
 * between the minimap and the edge. So we ALSO zero the size when the minimap shows
 * (minimap flush to the edge), and restore the grabbable 14px when the scrollbar is
 * the affordance again.
 */
export function minimapToggleOptions(show: boolean) {
  return {
    minimap: { enabled: show, renderCharacters: false, showSlider: "always" as const },
    scrollbar: {
      vertical: (show ? "hidden" : "auto") as "hidden" | "auto",
      verticalScrollbarSize: show ? 0 : 14,
      horizontalScrollbarSize: 8,
      scrollByPage: true,
    },
  };
}
