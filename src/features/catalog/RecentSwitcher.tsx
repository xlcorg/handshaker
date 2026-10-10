import { useEffect, useRef, useState } from "react";
import type { CollectionIpc, SavedRequestIpc } from "@/ipc/bindings";
import { messages } from "@/lib/messages";
import { cn } from "@/lib/cn";
import { useWorkflowState } from "@/features/workflow/store";
import {
  INITIAL_SWITCHER,
  loadedDraft,
  locationKey,
  paneLocation,
  readKey,
  reduceSwitcher,
  type SwitcherEvent,
  type SwitcherState,
  type SwitchTarget,
  type World,
} from "./recentModel";

export interface RecentSwitcherProps {
  overviewId: string | null;
  collections: CollectionIpc[];
  onOpenRequest: (collectionId: string, request: SavedRequestIpc) => void;
  onOpenCollection: (collectionId: string) => void;
  onRevealDraft: () => void;
}

const TRANSIENT_LAYER = '[role="dialog"],[role="alertdialog"],[role="menu"]';

function inTransientLayer(el: Element | null): boolean {
  return el?.closest(TRANSIENT_LAYER) != null;
}

export function RecentSwitcher(props: RecentSwitcherProps) {
  const workflow = useWorkflowState();
  const world: World = {
    collections: props.collections,
    overviewId: props.overviewId,
    loaded: loadedDraft(workflow),
    blocked: false,
  };
  const here = paneLocation(world);
  const hereKey = here ? locationKey(here) : null;

  const [state, setState] = useState<SwitcherState>(INITIAL_SWITCHER);
  const stateRef = useRef(state);
  const worldRef = useRef(world);
  const propsRef = useRef(props);
  const hereRef = useRef(here);
  const rootRef = useRef<HTMLDivElement>(null);
  const swallowContextMenu = useRef(false);

  worldRef.current = world;
  propsRef.current = props;
  hereRef.current = here;

  function dispatch(event: SwitcherEvent) {
    const result = reduceSwitcher(stateRef.current, event, worldRef.current);
    stateRef.current = result.state;
    setState(result.state);
    if (result.commit) activate(result.commit);
  }

  function activate(target: SwitchTarget) {
    const current = propsRef.current;
    switch (target.kind) {
      case "reveal":
        current.onRevealDraft();
        return;
      case "open":
        current.onOpenRequest(target.collectionId, target.request);
        return;
      case "overview":
        current.onOpenCollection(target.collectionId);
        return;
      default: {
        const unreachable: never = target;
        return unreachable;
      }
    }
  }

  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  useEffect(() => {
    const loc = hereRef.current;
    if (loc) dispatchRef.current({ type: "visit", location: loc });
  }, [hereKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const holding = stateRef.current.gesture.phase === "holding";
      const read = readKey(e, holding);
      if (!read) return;
      if (read.swallow) {
        e.preventDefault();
        e.stopPropagation();
      }
      worldRef.current = {
        ...worldRef.current,
        blocked: inTransientLayer(document.activeElement),
      };
      dispatchRef.current(read.event);
    };

    const onPointerDown = (e: PointerEvent) => {
      // pointerdown precedes the mousedown that arms the latch, so the click in
      // progress still swallows its contextmenu. A later press does not.
      swallowContextMenu.current = false;
      if (stateRef.current.gesture.phase !== "holding") return;
      const root = rootRef.current;
      const target = e.target;
      if (root && target instanceof Node && root.contains(target)) return;
      if (e.ctrlKey || e.button === 2) swallowContextMenu.current = true;
      dispatchRef.current({ type: "cancel" });
    };

    const onBlur = () => {
      if (stateRef.current.gesture.phase !== "holding") return;
      dispatchRef.current({ type: "cancel" });
    };

    const onContextMenu = (e: MouseEvent) => {
      const holding = stateRef.current.gesture.phase === "holding";
      if (!holding && !swallowContextMenu.current) return;
      e.preventDefault();
      e.stopPropagation();
      swallowContextMenu.current = false;
    };

    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("blur", onBlur);
    window.addEventListener("contextmenu", onContextMenu, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("contextmenu", onContextMenu, true);
    };
  }, []);

  if (state.gesture.phase !== "holding") return null;
  const { rows, cursor } = state.gesture;

  return (
    <div
      ref={rootRef}
      role="listbox"
      aria-label={messages.switcher.title}
      className="fixed top-[12vh] left-1/2 z-50 w-[min(36rem,calc(100%-2rem))] -translate-x-1/2 overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg"
    >
      {rows.map((row, i) => {
        const selected = i === cursor;
        return (
          <div
            key={row.key}
            role="option"
            aria-selected={selected}
            className={cn(
              "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
              selected && "bg-accent text-accent-foreground",
            )}
            onMouseDown={(ev) => {
              if (ev.button !== 0) return;
              ev.preventDefault();
              // The committing mousedown unmounts this layer before macOS delivers contextmenu.
              swallowContextMenu.current = true;
              dispatch({ type: "pick", index: i });
            }}
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-medium">{row.title}</span>
              {row.detail ? (
                <span className="truncate font-mono text-[11px] text-muted-foreground">
                  {row.detail}
                </span>
              ) : null}
            </span>
            {row.aside ? (
              <span className="flex-none truncate font-mono text-[11px] text-muted-foreground">
                {row.aside}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
