import { useState, useCallback } from "react";
import { mkTab, type RequestTabState } from "./tabModel";

export function useTabs(initial?: RequestTabState[]) {
  const [tabs, setTabs] = useState<RequestTabState[]>(() => initial ?? [mkTab({ scenario: "newServer" })]);
  const [activeId, setActiveId] = useState<string>(() => (initial ?? [])[0]?.id ?? tabs[0]?.id ?? "");
  const [closing, setClosing] = useState<RequestTabState | null>(null);

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];

  const patchTab = useCallback(
    (id: string, p: Partial<RequestTabState> | ((t: RequestTabState) => Partial<RequestTabState>)) => {
      setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, ...(typeof p === "function" ? p(t) : p) } : t)));
    },
    [],
  );
  const patchActive = useCallback(
    (p: Partial<RequestTabState> | ((t: RequestTabState) => Partial<RequestTabState>)) => {
      patchTab(active.id, p);
    },
    [active.id, patchTab],
  );

  const newTab = useCallback(() => {
    const t = mkTab({ scenario: "newServer" });
    setTabs((ts) => [...ts, t]);
    setActiveId(t.id);
  }, []);

  const closeTab = useCallback((id: string) => {
    setTabs((ts) => {
      if (ts.length === 1) {
        const t = mkTab({ scenario: "newServer" });
        setActiveId(t.id);
        return [t];
      }
      const idx = ts.findIndex((x) => x.id === id);
      const next = ts.filter((x) => x.id !== id);
      setActiveId((cur) => (cur === id ? (next[idx] ?? next[idx - 1] ?? next[0]).id : cur));
      return next;
    });
  }, []);

  const requestClose = useCallback(
    (t: RequestTabState) => {
      if (t.draft.dirty) setClosing(t);
      else closeTab(t.id);
    },
    [closeTab],
  );

  return { tabs, setTabs, active, activeId, setActiveId, patchTab, patchActive, newTab, closeTab, requestClose, closing, setClosing };
}
