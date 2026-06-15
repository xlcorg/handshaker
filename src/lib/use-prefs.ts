import { useEffect, useState } from "react";

export type SplitDir = "horizontal" | "vertical";
export type GrpcIconStyle = "solid" | "letter" | "outline" | "circle";
/** How a service group header is visually separated from its methods in the MethodPicker dropdown. */
export type MethodGroupStyle = "band" | "tree" | "weight" | "card" | "bar" | "chip" | "zebra";
/** Color palette for `{{var}}` token highlighting (resolved vs unresolved/cycle).
 *  See the `[data-vh-scheme]` blocks in globals.css for the actual colors. */
export type VarHighlightScheme = "indigo" | "amber" | "mono" | "teal" | "slate" | "text";

export interface Prefs {
  sidebar: boolean;
  /** Sidebar panel size as a percent of the window (resizable, persisted). Clamped to [12, 40]
   *  by the ResizablePanel. */
  sidebarPanel: number;
  /** Request body pane size as a percent of the call panel (resizable, persisted).
   *  Clamped to [20, 80] by the ResizablePanel. Shared across split orientations. */
  bodyPanel: number;
  split: SplitDir;
  /** Webview zoom factor (1 = 100%). Persisted; applied via webview.setZoom. */
  zoom: number;
  /** Per-request deadline in ms, applied backend-side via tokio timeout. */
  requestTimeoutMs: number;
  grpcIcon: GrpcIconStyle;
  /** Service-group header style in the MethodPicker dropdown. */
  methodGroupStyle: MethodGroupStyle;
  /** Color palette for `{{var}}` token highlighting in editors. */
  varHighlight: VarHighlightScheme;
  /** Inline contract hints in the request body editor: the ghost skeleton. */
  bodyHints: boolean;
  /** Перенос длинных строк в редакторах тела запроса/ответа. Off → гориз. скролл. */
  wordWrap: boolean;
}

export const PREFS_DEFAULTS: Prefs = {
  sidebar: true,
  sidebarPanel: 18,
  bodyPanel: 50,
  split: "vertical",
  zoom: 1,
  requestTimeoutMs: 30000,
  grpcIcon: "solid",
  methodGroupStyle: "zebra",
  varHighlight: "indigo",
  bodyHints: true,
  wordWrap: false,
};

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 3;
export const ZOOM_STEP = 0.1;

/** Clamp to [ZOOM_MIN, ZOOM_MAX] and snap to one decimal to avoid float drift. */
export function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 10) / 10));
}

export const TIMEOUT_MIN_MS = 1000;

/** Floor to TIMEOUT_MIN_MS and round to an integer ms (rejects NaN/sub-second input). */
export function clampTimeoutMs(ms: number): number {
  if (!Number.isFinite(ms)) return TIMEOUT_MIN_MS;
  return Math.max(TIMEOUT_MIN_MS, Math.round(ms));
}

const STORAGE_KEY = "handshaker.prefs.v1";

function read(): Prefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return PREFS_DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return { ...PREFS_DEFAULTS, ...parsed };
  } catch {
    return PREFS_DEFAULTS;
  }
}

const listeners = new Set<(p: Prefs) => void>();
let current = read();

function broadcast(next: Prefs) {
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — keep in-memory state */
  }
  for (const fn of listeners) fn(next);
}

export function usePrefs(): [Prefs, <K extends keyof Prefs>(key: K, value: Prefs[K]) => void] {
  const [state, setState] = useState(current);
  useEffect(() => {
    listeners.add(setState);
    return () => {
      listeners.delete(setState);
    };
  }, []);
  function setKey<K extends keyof Prefs>(key: K, value: Prefs[K]) {
    broadcast({ ...current, [key]: value });
  }
  return [state, setKey];
}

export function readPrefs(): Prefs {
  return current;
}
