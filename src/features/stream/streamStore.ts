import { useSyncExternalStore } from "react";
import type {
  MethodKindIpc,
  OutboundMessageIpc,
  SavedAuthConfigIpc,
  StatusDetailIpc,
  StreamEventIpc,
} from "@/ipc/bindings";
import { faultFromIpcError, type ClientFault } from "@/features/workflow/netDiagnostics";

/** Lifecycle of one Stream call as the webview sees it (glossary: Open → Stream start →
 *  Stream end / Cancel). `opening` = `stream_open` in flight; `open` = `Opened` arrived. */
export type StreamPhase = "opening" | "open" | "ended" | "cancelled" | "faulted";

/** Per-message meta the webview keeps — bodies stay in the core Stream store. */
export interface MessageMeta {
  dir: "in" | "out";
  index: number;
  atMs: number;
  sizeBytes: number;
  preview: string;
  /** Inline pretty JSON when the message is small enough (≤ 64 KiB); else null. */
  json: string | null;
}

export interface StreamEnd {
  statusCode: number;
  statusMessage: string;
  statusDetails: StatusDetailIpc[];
  trailingMetadata: Record<string, string>;
  elapsedMs: number;
  messageCount: number;
  totalBytes: number;
}

export interface StreamEntry {
  /** = the request id the call was opened with (`Step.streamId`). */
  id: string;
  /** The kind the UI opened with; replaced by `Opened.kind` (core's fact). */
  kind: MethodKindIpc;
  phase: StreamPhase;
  /** Two-way calls only: the outbound side ended (`stream_half_close` resolved) while
   *  the call stays live until the server's End. Frontend-known; never an event. */
  halfClosed: boolean;
  /** Last **Send message** rejection (`UnresolvedVars`, `EncodeRequest`, `StreamClosed`)
   *  — the call stays open, so this is data on the live entry, not a terminal fault.
   *  Cleared by the next accepted message, a successful half-close, any terminal
   *  transition (End / Fault / Cancel) or explicitly; never outlives the live call. */
  sendFault: ClientFault | null;
  headers: Record<string, string> | null;
  /** Oldest first (append order); the timeline reverses for display. */
  messages: MessageMeta[];
  end: StreamEnd | null;
  cancelled: boolean;
  /** Post-Open transport fault (`Fault` event) as data; pre-Open faults never reach the
   *  store. The face is the step's (`Step.error`), rendered by the call panel. */
  fault: ClientFault | null;
  /** Non-repeated `bytes` fields of the response type (Assemble candidates, ticket 18). */
  bytesFields: string[];
  /** Auth / TLS the core pipeline actually used, from `Opened` — feeds the executed snapshot. */
  authUsed: SavedAuthConfigIpc | null;
  tlsUsed: boolean | null;
  /** Epoch ms passed to `open()` — the one clock the footer runs on, live and frozen. */
  openedAt: number;
  /** Frozen elapsed, `terminal time − openedAt` for End, Fault and Cancel alike (the same
   *  clock the live footer ticked on, so it never snaps); null while live. The wire's
   *  `End.elapsed_ms` stays available as data on `end`. */
  elapsedMs: number | null;
  /** Running inbound byte total. */
  totalBytes: number;
}

export type StreamState = ReadonlyMap<string, StreamEntry>;

let entries: Map<string, StreamEntry> = new Map();
const listeners = new Set<() => void>();
const queue = new Map<string, StreamEventIpc[]>();
let frameScheduled = false;

function emit() {
  for (const l of listeners) l();
}

function strMap(m: Partial<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(m)) if (v !== undefined) out[k] = v;
  return out;
}

export function isLivePhase(phase: StreamPhase): boolean {
  return phase === "opening" || phase === "open";
}

/** Pure per-event transition. Terminal entries ignore every later event; a terminal event
 *  drops a pending send fault (the strip is about the live outbound side). */
function apply(e: StreamEntry, ev: StreamEventIpc): StreamEntry {
  if (!isLivePhase(e.phase)) return e;
  switch (ev.type) {
    case "Opened":
      return { ...e, phase: "open", kind: ev.kind, authUsed: ev.auth_used, tlsUsed: ev.tls_used, bytesFields: ev.bytes_fields };
    case "Headers":
      return { ...e, headers: strMap(ev.metadata) };
    case "Message": {
      const meta: MessageMeta = {
        dir: "in", index: ev.index, atMs: ev.at_ms, sizeBytes: ev.size_bytes, preview: ev.preview, json: ev.json,
      };
      return { ...e, messages: [...e.messages, meta], totalBytes: e.totalBytes + ev.size_bytes };
    }
    case "End":
      return {
        ...e,
        phase: "ended",
        sendFault: null,
        elapsedMs: Date.now() - e.openedAt,
        end: {
          statusCode: ev.status_code,
          statusMessage: ev.status_message,
          statusDetails: ev.status_details,
          trailingMetadata: strMap(ev.trailing_metadata),
          elapsedMs: ev.elapsed_ms,
          messageCount: ev.message_count,
          totalBytes: ev.total_bytes,
        },
      };
    case "Fault":
      return {
        ...e, phase: "faulted", sendFault: null, elapsedMs: Date.now() - e.openedAt, fault: faultFromIpcError(ev.error),
      };
  }
}

function flush() {
  frameScheduled = false;
  if (queue.size === 0) return;
  let next: Map<string, StreamEntry> | null = null;
  for (const [id, evs] of queue) {
    const cur = (next ?? entries).get(id);
    if (!cur) continue;
    let e = cur;
    for (const ev of evs) e = apply(e, ev);
    if (e !== cur) {
      next ??= new Map(entries);
      next.set(id, e);
    }
  }
  queue.clear();
  if (next) {
    entries = next;
    emit();
  }
}

function scheduleFlush() {
  if (frameScheduled) return;
  frameScheduled = true;
  const raf: (cb: FrameRequestCallback) => unknown =
    typeof requestAnimationFrame === "function" ? requestAnimationFrame : (cb) => setTimeout(() => cb(0), 16);
  raf(flush);
}

/** Frontend Stream store: one entry per live or finished Stream call, keyed by request
 *  id. Channel events are batched per animation frame (`push`); terminal events (`End`,
 *  `Fault`) flush synchronously so the step status and the pane agree in the same tick. */
export const streamStore = {
  getState(): StreamState {
    return entries;
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  get(id: string | null | undefined): StreamEntry | null {
    return id ? entries.get(id) ?? null : null;
  },
  open(id: string, kind: MethodKindIpc, openedAt: number) {
    const entry: StreamEntry = {
      id, kind, phase: "opening", halfClosed: false, sendFault: null, headers: null, messages: [], end: null,
      cancelled: false, fault: null, bytesFields: [], authUsed: null, tlsUsed: null, openedAt,
      elapsedMs: null, totalBytes: 0,
    };
    entries = new Map(entries).set(id, entry);
    emit();
  },
  /** Queue a channel event; applied on the next animation frame (terminal events: now). */
  push(id: string, ev: StreamEventIpc) {
    if (!entries.has(id)) return;
    const q = queue.get(id);
    if (q) q.push(ev);
    else queue.set(id, [ev]);
    if (ev.type === "End" || ev.type === "Fault") flush();
    else scheduleFlush();
  },
  /** Append the ack of an accepted **Send message** as a `→` row, synchronously (the user
   *  just clicked — no frame to wait for). `index` is the numbering shared with inbound
   *  rows; `json` is the resolved body that went on the wire, so expand needs no fetch.
   *  Inbound byte totals are untouched. Clears a pending send fault. */
  pushOutbound(id: string, ack: OutboundMessageIpc) {
    flush();
    const cur = entries.get(id);
    if (!cur || !isLivePhase(cur.phase)) return;
    const meta: MessageMeta = {
      dir: "out", index: ack.index, atMs: ack.at_ms, sizeBytes: ack.size_bytes, preview: ack.preview, json: ack.json,
    };
    entries = new Map(entries).set(id, { ...cur, messages: [...cur.messages, meta], sendFault: null });
    emit();
  },
  /** Mark a live two-way call half-closed (after `stream_half_close` resolved): the phase
   *  stays live — only the server's End / a Fault / Cancel ends it. The outbound side is
   *  over, so a pending send fault goes with it. */
  halfClose(id: string) {
    flush();
    const cur = entries.get(id);
    if (!cur || !isLivePhase(cur.phase) || cur.halfClosed) return;
    entries = new Map(entries).set(id, { ...cur, halfClosed: true, sendFault: null });
    emit();
  },
  /** Record a rejected **Send message** on the live entry (the stream stays open). */
  setSendFault(id: string, fault: ClientFault) {
    flush();
    const cur = entries.get(id);
    if (!cur || !isLivePhase(cur.phase)) return;
    entries = new Map(entries).set(id, { ...cur, sendFault: fault });
    emit();
  },
  clearSendFault(id: string) {
    const cur = entries.get(id);
    if (!cur || cur.sendFault === null) return;
    entries = new Map(entries).set(id, { ...cur, sendFault: null });
    emit();
  },
  /** Mark a live call cancelled (after `grpc_cancel` resolved): freezes elapsed, keeps the
   *  rows, drops anything still queued and any pending send fault. Returns false when the
   *  call had already ended. */
  cancel(id: string): boolean {
    flush(); // a queued End must win over a racing Cancel
    const cur = entries.get(id);
    if (!cur || !isLivePhase(cur.phase)) return false;
    entries = new Map(entries).set(id, {
      ...cur, phase: "cancelled", cancelled: true, sendFault: null, elapsedMs: Date.now() - cur.openedAt,
    });
    emit();
    return true;
  },
  /** Cache the body of row `index` fetched via `stream_message` (a `> 64 KiB` message
   *  arrives with `json: null`), so re-expanding never refetches. Unknown id/row → no-op. */
  setMessageJson(id: string, index: number, json: string) {
    const cur = entries.get(id);
    const at = cur?.messages.findIndex((m) => m.dir === "in" && m.index === index) ?? -1;
    if (!cur || at < 0) return;
    const messages = cur.messages.slice();
    messages[at] = { ...messages[at], json };
    entries = new Map(entries).set(id, { ...cur, messages });
    emit();
  },
  /** Forget an entry (the release rule frees the core store alongside). */
  drop(id: string) {
    queue.delete(id);
    if (!entries.has(id)) return;
    const next = new Map(entries);
    next.delete(id);
    entries = next;
    emit();
  },
  reset() {
    entries = new Map();
    queue.clear();
    frameScheduled = false;
    emit();
  },
};

/** Subscribe to one call's entry; null when the step has no stream or it was released.
 *  A selector: the store replaces entries immutably, so a change on another call leaves
 *  this snapshot referentially identical and the subscriber does not re-render. */
export function useStreamEntry(id: string | null | undefined): StreamEntry | null {
  return useSyncExternalStore(streamStore.subscribe, () => streamStore.get(id));
}
