import { useEffect, useRef } from "react";
import type { SavedRequestIpc } from "@/ipc/bindings";
import { useDraft, useDraftOrigin } from "@/features/workflow/store";
import { autosaveDraft } from "./save";

const AUTOSAVE_DELAY_MS = 500;

/**
 * Debounced autosave of an **origin-bound** draft: every content edit reconstructs the owning
 * request and persists it via `updateItemContent`. Unbound drafts (and the bind moment itself,
 * which carries no edit yet) never autosave.
 */
export function useAutosaveDraft(
  updateItemContent: (collectionId: string, itemId: string, content: SavedRequestIpc) => Promise<void>,
  delayMs: number = AUTOSAVE_DELAY_MS,
): void {
  const draft = useDraft();
  const origin = useDraftOrigin();
  const boundKey = origin ? `${origin.collectionId}/${origin.requestId}` : null;
  // Armed on every (re)bind so the first content effect for a freshly bound origin is skipped.
  const skipRef = useRef<string | null>(null);

  useEffect(() => {
    skipRef.current = boundKey;
  }, [boundKey]);

  useEffect(() => {
    if (!origin || !draft) return;
    if (skipRef.current === boundKey) {
      // First run after (re)bind — consume the skip, do not save.
      skipRef.current = null;
      return;
    }
    const t = setTimeout(() => {
      void autosaveDraft(updateItemContent, origin, draft);
    }, delayMs);
    return () => clearTimeout(t);
  }, [draft, origin, boundKey, delayMs, updateItemContent]);
}
