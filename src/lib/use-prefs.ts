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
}

export const PREFS_DEFAULTS: Prefs = {
  theme: "dark",
  density: "regular",
  sidebar: true,
  split: "horizontal",
  fontUi: "inter",
  fontMono: "jetbrains",
  dots: true,
};

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
