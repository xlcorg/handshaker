import type { MessageSchemaIpc } from "@/ipc/bindings";
import { parseWithSpans } from "./parse";

export interface GhostBlock {
  /** 1-based line the zone is inserted AFTER (the last top-level entry / the `{`). */
  afterLine: number;
  /** Rendered ghost lines, already indented: `  "jsonName": TypeLabel`. */
  lines: string[];
}

/** Returns the 1-based line number of the given 0-based char offset. */
function lineOfOffset(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text[i] === "\n") line++;
  return line;
}

/** Top-level diff: root-message fields minus keys present at depth 1. Null when
 *  the body is unparseable, the root isn't an object, or nothing is missing. */
export function computeGhostLines(text: string, schema: MessageSchemaIpc): GhostBlock | null {
  const parsed = parseWithSpans(text);
  if (!parsed || parsed.tree.rootId === null) return null;
  const root = parsed.tree.nodes[parsed.tree.rootId];
  if (!root || root.kind !== "object") return null;
  const rootMsg = schema.messages.find((m) => m.full_name === schema.root);
  if (!rootMsg) return null;

  const present = new Set(root.childIds.map((id) => parsed.tree.nodes[id]?.key));
  const missing = rootMsg.fields.filter((fl) => !present.has(fl.json_name));
  if (missing.length === 0) return null;

  const spanByNode = new Map(parsed.spans.map((s) => [s.nodeId, s]));
  const rootSpan = spanByNode.get(root.id);
  const lastChildId = root.childIds[root.childIds.length - 1];
  // parseWithSpans guarantees a span for every node id, so the ?? branches are
  // unreachable; optional chaining just satisfies the type checker without `!`.
  const contentOffset = lastChildId !== undefined
    ? (spanByNode.get(lastChildId)?.end ?? 0)
    : (rootSpan?.start ?? 0) + 1;
  // Anchor at whichever sits lower: the last entry's end, or the line just above
  // the closing brace. Blank lines after the last entry — notably the caret line
  // Enter just created — thus stay ABOVE the ghost; the skeleton never wedges
  // itself between the user's typing position and the code above it. (For a
  // one-line `{}` the brace line minus one would be 0, so the content line wins.)
  const closeLine = lineOfOffset(text, Math.max((rootSpan?.end ?? text.length) - 1, 0));
  return {
    afterLine: Math.max(lineOfOffset(text, contentOffset), closeLine - 1),
    lines: missing.map((fl) => `  "${fl.json_name}": ${fl.type_label}`),
  };
}

// --- Monaco glue (structurally typed so tests need no real editor) -----------

interface ViewZoneAccessorLike {
  addZone(zone: {
    afterLineNumber: number;
    heightInLines: number;
    domNode: HTMLElement;
    suppressMouseDown?: boolean;
  }): string;
  removeZone(id: string): void;
}

export interface ViewZoneEditorLike {
  changeViewZones(cb: (accessor: ViewZoneAccessorLike) => void): void;
  /** Copies the editor's exact font (family/size/line-height) onto `target`.
   *  Required: Monaco applies fontInfo only to `.view-lines`, so a view-zone
   *  domNode otherwise inherits the app's UI font — rows come out taller than
   *  the reserved `heightInLines` (the block drifts onto the next real line)
   *  and the proportional indent doesn't line up with the code. */
  applyFontInfo(target: HTMLElement): void;
}

export function ghostDomNode(lines: string[]): HTMLElement {
  const node = document.createElement("div");
  node.className = "hs-ghost-skeleton";
  for (const l of lines) {
    const row = document.createElement("div");
    row.textContent = l;
    node.appendChild(row);
  }
  return node;
}

/** Owns at most ONE view zone on an editor; `apply(null)` removes it. */
export class GhostZone {
  private zoneId: string | null = null;
  constructor(private readonly editor: ViewZoneEditorLike) {}

  apply(block: GhostBlock | null): void {
    this.editor.changeViewZones((acc) => {
      if (this.zoneId !== null) {
        acc.removeZone(this.zoneId);
        this.zoneId = null;
      }
      if (!block) return;
      // A view-zone domNode is rendered in the content area (Monaco's separate
      // marginDomNode is the margin-side counterpart), so it already aligns at
      // the code's content origin — past the line-number gutter. The ghost text
      // carries its own 2-space field indent, so no horizontal offset is needed;
      // adding contentLeft here would push it a full gutter-width too far right.
      const node = ghostDomNode(block.lines);
      this.editor.applyFontInfo(node);
      this.zoneId = acc.addZone({
        afterLineNumber: block.afterLine,
        heightInLines: block.lines.length,
        domNode: node,
        suppressMouseDown: true,
      });
    });
  }

  dispose(): void {
    this.apply(null);
  }
}
