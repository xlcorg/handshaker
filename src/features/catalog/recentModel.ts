import type { CollectionIpc, SavedRequestIpc } from "@/ipc/bindings";
import type { WorkflowState } from "@/features/workflow/store";
import { messages } from "@/lib/messages";
import { flattenRequests, methodLabel, type RequestHit } from "./palette";

const MAX_RECENT = 10;

export type PaneLocation =
  | { kind: "request"; itemId: string }
  | { kind: "overview"; collectionId: string }
  | { kind: "draft" };

export type LoadedDraft =
  | { kind: "none" }
  | { kind: "unbound" }
  | { kind: "bound"; requestId: string };

export interface World {
  collections: CollectionIpc[];
  overviewId: string | null;
  loaded: LoadedDraft;
  /** A dialog, alert dialog, or menu has focus. An opening Tab stays idle. */
  blocked: boolean;
}

export type SwitchTarget =
  | { kind: "reveal" }
  | { kind: "open"; collectionId: string; request: SavedRequestIpc }
  | { kind: "overview"; collectionId: string };

export interface SwitcherRow {
  key: string;
  target: SwitchTarget;
  title: string;
  detail: string | null;
  aside: string | null;
}

export type Gesture =
  | { phase: "idle" }
  | { phase: "holding"; rows: readonly SwitcherRow[]; cursor: number };

export interface SwitcherState {
  recent: readonly PaneLocation[];
  gesture: Gesture;
}

export type SwitcherEvent =
  | { type: "visit"; location: PaneLocation }
  | { type: "tab"; back: boolean }
  | { type: "release" }
  | { type: "pick"; index: number }
  | { type: "cancel" };

export interface Transition {
  state: SwitcherState;
  commit: SwitchTarget | null;
}

export interface KeyRead {
  event: SwitcherEvent;
  swallow: boolean;
}

type KeyLike = Pick<
  KeyboardEvent,
  "type" | "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
>;

export const INITIAL_SWITCHER: SwitcherState = {
  recent: [],
  gesture: { phase: "idle" },
};

export function loadedDraft(
  st: Pick<WorkflowState, "draft" | "draftOrigin">,
): LoadedDraft {
  if (!st.draft) return { kind: "none" };
  if (!st.draftOrigin) return { kind: "unbound" };
  return { kind: "bound", requestId: st.draftOrigin.requestId };
}

export function paneLocation(
  world: Pick<World, "overviewId" | "loaded">,
): PaneLocation | null {
  if (world.overviewId)
    return { kind: "overview", collectionId: world.overviewId };
  switch (world.loaded.kind) {
    case "none":
      return null;
    case "unbound":
      return { kind: "draft" };
    case "bound":
      return { kind: "request", itemId: world.loaded.requestId };
    default: {
      const unreachable: never = world.loaded;
      return unreachable;
    }
  }
}

export function locationKey(loc: PaneLocation): string {
  switch (loc.kind) {
    case "request":
      return `r:${loc.itemId}`;
    case "overview":
      return `o:${loc.collectionId}`;
    case "draft":
      return "draft";
    default: {
      const unreachable: never = loc;
      return unreachable;
    }
  }
}

export function reduceSwitcher(
  s: SwitcherState,
  e: SwitcherEvent,
  world: World,
): Transition {
  switch (e.type) {
    case "visit": {
      const recent = moveToFront(s.recent, e.location);
      if (recent === s.recent) return { state: s, commit: null };
      return { state: { recent, gesture: s.gesture }, commit: null };
    }
    case "tab": {
      if (s.gesture.phase === "holding") {
        const n = s.gesture.rows.length;
        const cursor = (s.gesture.cursor + (e.back ? -1 : 1) + n) % n;
        return {
          state: {
            recent: s.recent,
            gesture: { phase: "holding", rows: s.gesture.rows, cursor },
          },
          commit: null,
        };
      }
      if (world.blocked) return { state: s, commit: null };
      const gesture = begin(s.recent, world, e.back);
      if (gesture.phase === "idle") return { state: s, commit: null };
      return { state: { recent: s.recent, gesture }, commit: null };
    }
    case "release": {
      if (s.gesture.phase !== "holding") return { state: s, commit: null };
      return {
        state: { recent: s.recent, gesture: { phase: "idle" } },
        commit: s.gesture.rows[s.gesture.cursor].target,
      };
    }
    case "pick": {
      if (s.gesture.phase !== "holding") return { state: s, commit: null };
      const row = s.gesture.rows[e.index];
      if (!row) return { state: s, commit: null };
      return {
        state: { recent: s.recent, gesture: { phase: "idle" } },
        commit: row.target,
      };
    }
    case "cancel": {
      if (s.gesture.phase !== "holding") return { state: s, commit: null };
      return {
        state: { recent: s.recent, gesture: { phase: "idle" } },
        commit: null,
      };
    }
    default: {
      const unreachable: never = e;
      return unreachable;
    }
  }
}

export function readKey(e: KeyLike, holding: boolean): KeyRead | null {
  if (
    e.type === "keydown" &&
    e.key === "Tab" &&
    e.ctrlKey &&
    !e.metaKey &&
    !e.altKey
  ) {
    return { event: { type: "tab", back: e.shiftKey }, swallow: true };
  }
  if (!holding) return null;
  if (e.type === "keyup" && e.key === "Control") {
    return { event: { type: "release" }, swallow: false };
  }
  if (e.type === "keydown" && e.key === "Escape") {
    return { event: { type: "cancel" }, swallow: true };
  }
  if (e.type === "keydown" && (e.key === "Control" || e.key === "Shift"))
    return null;
  if (e.type === "keydown")
    return { event: { type: "cancel" }, swallow: false };
  return null;
}

function moveToFront(
  recent: readonly PaneLocation[],
  loc: PaneLocation,
): readonly PaneLocation[] {
  if (recent.length > 0 && locationKey(recent[0]) === locationKey(loc))
    return recent;
  const key = locationKey(loc);
  return [loc, ...recent.filter((item) => locationKey(item) !== key)].slice(
    0,
    MAX_RECENT,
  );
}

function resolveRows(
  recent: readonly PaneLocation[],
  world: World,
): SwitcherRow[] {
  const hits = new Map<string, RequestHit>();
  for (const hit of flattenRequests(world.collections))
    hits.set(hit.request.id, hit);
  const rows: SwitcherRow[] = [];
  for (const loc of recent) {
    if (loc.kind === "request") {
      const hit = hits.get(loc.itemId);
      if (!hit) continue;
      const loaded =
        world.loaded.kind === "bound" && world.loaded.requestId === loc.itemId;
      rows.push({
        key: locationKey(loc),
        target: loaded
          ? { kind: "reveal" }
          : {
              kind: "open",
              collectionId: hit.collectionId,
              request: hit.request,
            },
        title: hit.request.name,
        detail: methodLabel(hit.request),
        aside: hit.collectionName,
      });
    } else if (loc.kind === "overview") {
      const collection = world.collections.find(
        (c) => c.id === loc.collectionId,
      );
      if (!collection) continue;
      rows.push({
        key: locationKey(loc),
        target: { kind: "overview", collectionId: collection.id },
        title: collection.name,
        detail: messages.switcher.overview,
        aside: null,
      });
    } else if (world.loaded.kind === "unbound") {
      rows.push({
        key: locationKey(loc),
        target: { kind: "reveal" },
        title: messages.workflow.draft.newRequest,
        detail: null,
        aside: null,
      });
    }
  }
  return rows;
}

function begin(
  recent: readonly PaneLocation[],
  world: World,
  back: boolean,
): Gesture {
  const rows = resolveRows(recent, world);
  const here = paneLocation(world);
  const start = here && rows[0]?.key === locationKey(here) ? 1 : 0;
  if (rows.length <= start) return { phase: "idle" };
  return { phase: "holding", rows, cursor: back ? rows.length - 1 : start };
}
