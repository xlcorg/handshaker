import { useEffect, useState } from "react";

export type ThemeMode = "dark" | "light";
export type Density = "compact" | "regular" | "cozy";
export type SplitDir = "horizontal" | "vertical";
export type FontUi = "inter" | "geist" | "system";
export type FontMono = "jetbrains" | "geist-mono" | "ibm";

export interface Prefs {
  theme: ThemeMode;
  density: Density;
  sidebar: boolean;
  split: SplitDir;
  fontUi: FontUi;
  fontMono: FontMono;
  dots: boolean;
  /** Webview zoom factor (1 = 100%). Persisted; applied via webview.setZoom. */
  zoom: number;
}

export const PREFS_DEFAULTS: Prefs = {
  theme: "dark",
  density: "regular",
  sidebar: true,
  split: "horizontal",
  fontUi: "inter",
  fontMono: "jetbrains",
  dots: true,
  zoom: 1,
};

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 3;
export const ZOOM_STEP = 0.1;

/** Clamp to [ZOOM_MIN, ZOOM_MAX] and snap to one decimal to avoid float drift. */
export function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 10) / 10));
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
