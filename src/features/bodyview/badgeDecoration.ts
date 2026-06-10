import type * as Monaco from "monaco-editor";
import { BADGE_CLASS } from "./controller";

/**
 * Monaco decoration options for an elision badge pill.
 *
 * `showIfCollapsed` is REQUIRED. The badge anchors on a zero-width range (the
 * offset just past the preview value's closing quote), and Monaco's
 * `getAllInjectedText` drops injected `after` text on collapsed ranges unless
 * this flag is set (see monaco `textModel` — `.filter(i => i.options.showIfCollapsed
 * || !i.range.isEmpty())`). Without it the pill never renders, so a truncated
 * value shows its preview with no size cue at all.
 */
export function badgeDecorationOptions(label: string) {
  return {
    showIfCollapsed: true,
    after: { content: ` ${label} `, inlineClassName: BADGE_CLASS },
  } satisfies Monaco.editor.IModelDecorationOptions;
}
