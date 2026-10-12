import { useEffect, useRef } from "react";
import type { RequestTemplateIpc } from "@/ipc/bindings";
import { useDraft, useDraftOrigin } from "@/features/workflow/store";
import { autosaveDraft } from "./save";

const AUTOSAVE_DELAY_MS = 500;

/**
 * Debounced autosave of an **origin-bound** draft: every content edit rebuilds the owning
 * request's template and persists it via `updateItemContent`. Unbound drafts (and the bind
 * moment itself, which carries no edit yet) never autosave.
 */
export function useAutosaveDraft(
  updateItemContent: (collectionId: string, itemId: string, content: RequestTemplateIpc) => Promise<void>,
  delayMs: number = AUTOSAVE_DELAY_MS,
): void {
  const draft = useDraft();
  const origin = useDraftOrigin();
  const boundKey = origin ? `${origin.collectionId}/${origin.requestId}` : null;
  const contentIdentity = draft?.protocol === "http" ? draft.template : draft;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const skipRef = useRef<string | null>(null);

  useEffect(() => {
    skipRef.current = boundKey;
  }, [boundKey]);

  useEffect(() => {
    if (!origin || !draftRef.current) return;
    if (skipRef.current === boundKey) {
      skipRef.current = null;
      return;
    }
    const t = setTimeout(() => {
      const current = draftRef.current;
      if (!current) return;
      void autosaveDraft(updateItemContent, origin, current);
    }, delayMs);
    return () => clearTimeout(t);
  }, [contentIdentity, origin, boundKey, delayMs, updateItemContent]);
}
