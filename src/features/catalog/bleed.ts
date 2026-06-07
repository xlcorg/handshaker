import type { CSSProperties } from "react";

// Each nested <SidebarMenuSub> insets its rows by roughly this much: the left side by
// `mx-2 + border-l + px-2` (≈18px) and the right side by `mx-2 + px-2` (≈15px), less a
// ~1px translate. Both the row highlight and the ⋯ action button break OUT of this inset
// so they reach the sidebar edges regardless of nesting depth (Postman-style full-width
// rows with indented content). Keep these in sync with the SidebarMenuSub className in
// CollectionNode/FolderNode — they are the single source of truth for the breakout math.
export const SUB_INSET_L = 18;
export const SUB_INSET_R = 15;

/**
 * CSS custom properties consumed by a row's full-bleed `::before` (background) and
 * `::after` (active marker). `--bl`/`--br` are negative offsets that pull those pseudo
 * elements out to the sidebar edges, leaving a ~2px gutter at any depth.
 */
export function bleedStyle(depth: number): CSSProperties {
  return {
    "--bl": `${3 - depth * SUB_INSET_L}px`,
    "--br": `${1 - depth * SUB_INSET_R}px`,
  } as CSSProperties;
}

/**
 * Right offset (px, may be negative) that pins a row's ⋯ action button to the sidebar
 * edge regardless of how deeply the row is nested. depth 0 → the unmodified padRight.
 */
export function actionRight(depth: number, padRight = 4): number {
  return padRight - depth * SUB_INSET_R;
}
