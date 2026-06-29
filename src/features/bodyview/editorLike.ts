export interface PositionLike { lineNumber: number; column: number; }

export interface ModelLike {
  getOffsetAt(position: PositionLike): number;
  getPositionAt(offset: number): PositionLike;
  setValue(text: string): void;
  getValueInRange(range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }): string;
}

export interface EditorMouseEventLike {
  event: { ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; detail: number; browserEvent: { preventDefault(): void } };
  target: { element: HTMLElement | null; position: PositionLike | null };
}

export interface DisposableLike { dispose(): void; }

export interface EditorLike {
  getModel(): ModelLike | null;
  onMouseDown(listener: (e: EditorMouseEventLike) => void): DisposableLike;
}
