import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/** Anchor the tab-strip progress comet's first pass under the active tab. Measures the
 *  tab's left relative to the header via bounding rects (NOT `offsetLeft` — the strip
 *  is `relative`, so it is the tabs' offsetParent and `offsetLeft` would be ~0 here).
 *  Re-measures while `active` whenever `tab` changes. Shared by the unary response
 *  pane and the Stream pane so both comets start from the same place. */
export function useTabBarStart(
  active: boolean,
  tab: string,
): { headerRef: RefObject<HTMLDivElement>; barStart: number } {
  const headerRef = useRef<HTMLDivElement>(null);
  const [barStart, setBarStart] = useState(0);
  useLayoutEffect(() => {
    if (!active) return;
    const header = headerRef.current;
    const activeTab = header?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (header && activeTab) {
      setBarStart(activeTab.getBoundingClientRect().left - header.getBoundingClientRect().left);
    }
  }, [active, tab]);
  return { headerRef, barStart };
}
