import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { ipc } from "@/ipc/client";
import type { CallRecordIpc, CallSummaryIpc, HistoryPageIpc } from "@/ipc/bindings";
import { messages } from "@/lib/messages";

export type HistoryState =
  | { phase: "loading" }
  /** Newest first, as core sent them. */
  | { phase: "ready"; revision: number; rows: readonly CallSummaryIpc[] }
  | { phase: "failed" };

const LOADING: HistoryState = { phase: "loading" };

let state: HistoryState = LOADING;
let hydrating = false;
const records = new Map<string, CallRecordIpc>();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function apply(page: HistoryPageIpc) {
  if (state.phase === "ready" && page.revision <= state.revision) return;
  state = { phase: "ready", revision: page.revision, rows: page.rows };
  const live = new Set(page.rows.map((row) => row.id));
  for (const id of records.keys()) if (!live.has(id)) records.delete(id);
  emit();
}

async function hydrate() {
  try {
    apply(await ipc.historyList());
  } catch {
    if (state.phase !== "loading") return;
    state = { phase: "failed" };
    emit();
  }
}

export const historyStore = {
  getState(): HistoryState {
    return state;
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    if (!hydrating) {
      hydrating = true;
      void hydrate();
    }
    return () => listeners.delete(fn);
  },
  /** Persist a finished call and apply the page after it. Never rejects: a refused record
   *  toasts and leaves the rows as they were. The call itself already finished. */
  async record(record: CallRecordIpc): Promise<void> {
    try {
      apply(await ipc.historyRecord(record));
    } catch {
      toast.error(messages.history.toast.recordFailed);
    }
  },
  /** A record by id. Never rejects: `null` means evicted, never recorded, or unreadable. */
  async load(id: string): Promise<CallRecordIpc | null> {
    const hit = records.get(id);
    if (hit) return hit;
    try {
      const record = await ipc.historyGet(id);
      if (record) records.set(id, record);
      return record;
    } catch {
      return null;
    }
  },
  reset() {
    state = LOADING;
    hydrating = false;
    records.clear();
    emit();
  },
};

export function useHistory(): HistoryState {
  return useSyncExternalStore(historyStore.subscribe, historyStore.getState);
}

export type RecordView = { phase: "loading" } | { phase: "ready"; record: CallRecordIpc } | { phase: "missing" };

export function useCallRecord(id: string | null): RecordView | null {
  const [loaded, setLoaded] = useState<{ id: string; record: CallRecordIpc | null } | null>(null);
  useEffect(() => {
    if (!id) return;
    let live = true;
    void historyStore.load(id).then((record) => {
      if (live) setLoaded({ id, record });
    });
    return () => {
      live = false;
    };
  }, [id]);
  if (!id) return null;
  if (loaded?.id !== id) return { phase: "loading" };
  return loaded.record ? { phase: "ready", record: loaded.record } : { phase: "missing" };
}
