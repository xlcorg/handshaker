import type { DragEvent } from "react";

const DND_KEY = "text/plain";

export interface RowDragProps {
  draggable: true;
  onDragStart: (e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
}

/**
 * Build a per-row drag-handler factory. The returned function takes a row index
 * and yields DnD props; dropping row A onto row B invokes `onReorder(A, B)`.
 */
export function makeDragHandlers(
  onReorder: (from: number, to: number) => void,
): (index: number) => RowDragProps {
  return (index: number) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData(DND_KEY, String(index));
      e.dataTransfer.effectAllowed = "move";
    },
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData(DND_KEY);
      const from = Number(raw);
      if (raw === "" || Number.isNaN(from) || from === index) return;
      onReorder(from, index);
    },
  });
}
