import { Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import type * as Monaco from "monaco-editor";
import { MonacoEditor, BODY_EDIT_OPTIONS, BODY_READONLY_OPTIONS, MONACO_THEME } from "@/lib/monaco";
import { usePrefs, readPrefs } from "@/lib/use-prefs";
import { parseWithSpans } from "./parse";
import { renderJsonTree, type Badge } from "./render";
import type { JsonTree } from "./jsonTree";
import type { ValueSpan } from "./spans";
import type { DisposableLike } from "./editorLike";
import { exceedsByteCeiling } from "./elide";
import { attachBodyController } from "./controller";
import { badgeDecorationOptions } from "./badgeDecoration";
import type { MessageSchemaIpc } from "@/ipc/bindings";
import { setModelSchema, computeSuggestions, collectPresentKeys } from "./completion";
import { GhostZone, computeGhostLines } from "./ghost";
import { computeUnknownFieldMarkers } from "./validate";

type Mode = "request" | "response";

export interface BodyViewProps {
  mode: Mode;
  value: string;
  onChange?: (next: string) => void;
  /** Ctrl/Cmd+Enter inside the editor (Monaco swallows it, so we bind a command). */
  onSubmit?: () => void;
  /** Flat field-schema attached to the model — request mode only: autocomplete,
   *  ghost skeleton, unknown-field markers. Response mode receives none (the
   *  Contract tab carries the contract). */
  schema?: MessageSchemaIpc | null;
}

interface Live {
  editor: Monaco.editor.IStandaloneCodeEditor;
  monaco: typeof Monaco;
  tree: JsonTree | null;
  spans: ValueSpan[];
  badges: Badge[];
  decorations: Monaco.editor.IEditorDecorationsCollection | null;
  expanded: Set<string>;
  controller: DisposableLike | null;
  typeSub: DisposableLike | null;
  ghost: GhostZone | null;
  ghostTimer: number | null;
  /** Line count after the last edit — a change means the ghost anchor moved. */
  lineCount: number;
  /** Текст, который последним видел handleChange/маунт — для детекта внешних обновлений value. */
  lastText: string;
}

export function BodyView({ mode, value, onChange, onSubmit, schema }: BodyViewProps) {
  const [prefs] = usePrefs();
  const live = useRef<Live | null>(null);
  // Ref so the Monaco command (bound once in onMount) always calls the freshest handler.
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;
  const schemaRef = useRef(schema);
  schemaRef.current = schema;

  // --- response rendering ------------------------------------------------
  const renderResponse = (text: string) => {
    const l = live.current;
    if (!l) return;
    if (exceedsByteCeiling(text)) {
      l.tree = null; l.spans = []; l.badges = [];
      l.editor.updateOptions({ folding: false });
      l.editor.getModel()?.setValue(text);
      l.decorations?.clear();
      return;
    }
    const parsed = parseWithSpans(text);
    if (!parsed) {
      // Invalid JSON: show raw, no spans/badges.
      l.tree = null; l.spans = []; l.badges = [];
      l.editor.getModel()?.setValue(text);
      l.decorations?.clear();
      return;
    }
    l.tree = parsed.tree;
    const r = renderJsonTree(parsed.tree, l.expanded);
    l.spans = r.spans;
    l.badges = r.badges;
    l.editor.getModel()?.setValue(r.text);
    paintBadges();
  };

  const paintBadges = () => {
    const l = live.current;
    const model = l?.editor.getModel();
    if (!l || !model) return;
    const decos: Monaco.editor.IModelDeltaDecoration[] = l.badges.map((b) => {
      const pos = model.getPositionAt(b.previewEnd);
      return {
        range: new l.monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
        options: badgeDecorationOptions(b.label),
      };
    });
    if (l.decorations) l.decorations.set(decos);
    else l.decorations = l.editor.createDecorationsCollection(decos);
  };

  const badgeNodeIdAt = (offset: number): string | null => {
    const l = live.current;
    const model = l?.editor.getModel();
    if (!l || !model) return null;
    const clickLine = model.getPositionAt(offset).lineNumber;
    // Pick the badge anchored on the clicked line (≤1 badge per line in practice).
    const hit = l.badges.find((b) => model.getPositionAt(b.previewEnd).lineNumber === clickLine);
    return hit?.nodeId ?? null;
  };

  const expandNode = (nodeId: string) => {
    const l = live.current;
    if (!l || !l.tree) return;
    l.expanded.add(nodeId);
    const r = renderJsonTree(l.tree, l.expanded);
    l.spans = r.spans;
    l.badges = r.badges;
    const view = l.editor.saveViewState();
    l.editor.getModel()?.setValue(r.text);
    if (view) l.editor.restoreViewState(view);
    paintBadges();
  };

  // Recompute the ghost skeleton NOW (cancelling any pending debounce).
  // Deps intentionally empty: reads live/schemaRef (stable refs) and readPrefs()
  // (module-level read) — nothing closes over React state.
  const applyGhost = useCallback(() => {
    const l = live.current;
    if (!l || !l.ghost) return;
    if (l.ghostTimer !== null) {
      window.clearTimeout(l.ghostTimer);
      l.ghostTimer = null;
    }
    const sc = schemaRef.current;
    const block =
      readPrefs().bodyHints && sc ? computeGhostLines(l.editor.getValue(), sc) : null;
    l.ghost.apply(block);
    // Contract diagnostics ride the same cadence but ignore the hints toggle: an
    // unknown field FAILS the Send (prost-reflect denies unknown fields), so this
    // is a diagnostic, not a hint. null = unparseable mid-edit → keep the previous
    // markers (VS Code behavior) instead of flashing them off per keystroke.
    const model = l.editor.getModel();
    if (!model) return;
    const markers = sc ? computeUnknownFieldMarkers(l.editor.getValue(), sc) : [];
    if (markers === null) return;
    l.monaco.editor.setModelMarkers(model, "hs-contract", markers.map((mk) => {
      const s = model.getPositionAt(mk.start);
      const e = model.getPositionAt(mk.end);
      return {
        severity: l.monaco.MarkerSeverity.Error,
        message: mk.message,
        startLineNumber: s.lineNumber,
        startColumn: s.column,
        endLineNumber: e.lineNumber,
        endColumn: e.column,
      };
    }));
  }, []);

  // Debounced recompute for same-line typing, so mid-token (briefly invalid JSON)
  // states don't flicker the ghost on every keystroke.
  const scheduleGhost = useCallback((delay: number) => {
    const l = live.current;
    if (!l || !l.ghost) return;
    if (l.ghostTimer !== null) window.clearTimeout(l.ghostTimer);
    l.ghostTimer = window.setTimeout(() => {
      l.ghostTimer = null;
      applyGhost();
    }, delay);
  }, [applyGhost]);

  // --- mount -------------------------------------------------------------
  const onMount = useCallback(
    (editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco) => {
      // Keyed remount fires onMount fresh per response value; tear down the
      // prior mount's subscriptions before attaching new ones.
      if (live.current?.ghostTimer != null) window.clearTimeout(live.current.ghostTimer);
      live.current?.ghost?.dispose();
      live.current?.controller?.dispose();
      live.current?.typeSub?.dispose();
      live.current = {
        editor, monaco, tree: null, spans: [], badges: [],
        decorations: null, expanded: new Set(), controller: null, typeSub: null,
        ghost: null, ghostTimer: null,
        lineCount: editor.getModel()?.getLineCount() ?? 1,
        lastText: editor.getValue(),
      };
      // Attach schema to the model (request mode is the only consumer:
      // autocomplete + ghost + unknown-field markers; response passes none).
      setModelSchema(editor.getModel(), schemaRef.current ?? null);
      if (mode === "request") {
        // Postman-style: opening a quote (a key or a value string) force-opens the
        // suggest widget. Monaco does NOT auto-trigger completion inside strings
        // (quickSuggestions / trigger-char gating differs by token context), so we
        // trigger it explicitly. `browserEvent.key` is the produced character, so this
        // is layout-independent. We only trigger when there's actually something to
        // suggest at the caret — otherwise Monaco shows a noisy "No suggestions" popup
        // on every value quote of a free-form string field.
        live.current.typeSub = editor.onKeyUp((e) => {
          if (e.browserEvent.key !== '"') return;
          const sc = schemaRef.current;
          const model = editor.getModel();
          const pos = editor.getPosition();
          if (!sc || !model || !pos) return;
          const textBefore = model.getValueInRange({
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: pos.lineNumber,
            endColumn: pos.column,
          });
          // Same present-key filter as the provider, so a fully-populated object
          // doesn't force-open an empty ("No suggestions") widget.
          const present = collectPresentKeys(model.getValue(), model.getOffsetAt(pos));
          if (computeSuggestions(sc, textBefore, present).length > 0) {
            editor.trigger("autocomplete", "editor.action.triggerSuggest", {});
          }
        });
        live.current.ghost = new GhostZone(editor);
        applyGhost();
      }
      if (mode === "response") {
        renderResponse(editor.getValue());
      } else {
        const parsed = parseWithSpans(editor.getValue());
        live.current.tree = parsed?.tree ?? null;
        live.current.spans = parsed?.spans ?? [];
      }
      // Monaco intercepts Ctrl/Cmd+Enter (inserts a newline by default), so the
      // window-level Send shortcut never sees it while the editor has focus.
      // Bind it here to forward to the Send handler instead — but ONLY when this
      // editor actually has a submit handler (i.e. the request editor). Monaco's
      // addCommand registers the keybinding across *all* editor instances and the
      // last registration wins (microsoft/monaco-editor#3345, #2947), so letting
      // the read-only response editor register a no-op would clobber the request
      // editor's command the moment a response renders — breaking the shortcut
      // after the first send.
      if (onSubmitRef.current) {
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
          onSubmitRef.current?.();
        });
      }
      live.current.controller = attachBodyController(editor, {
        getTree: () => live.current?.tree ?? null,
        getSpans: () => live.current?.spans ?? [],
        getBadgeNodeIdAt: mode === "response" ? badgeNodeIdAt : undefined,
        onBadgeExpand: mode === "response" ? expandNode : undefined,
      });
    },
    [mode, applyGhost],
  );

  // Dispose the controller + type subscriptions when BodyView itself unmounts.
  useEffect(() => () => {
    live.current?.controller?.dispose();
    live.current?.typeSub?.dispose();
    if (live.current?.ghostTimer != null) window.clearTimeout(live.current.ghostTimer);
    live.current?.ghost?.dispose();
  }, []);

  // Keep the model's attached schema current as the selected method changes.
  // Only request mode receives a schema (autocomplete + ghost + markers);
  // response mode's schema is always null/undefined, and applyGhost self-gates
  // on l.ghost (never created in response mode), so this runs unconditionally.
  useEffect(() => {
    const model = live.current?.editor.getModel();
    setModelSchema(model ?? null, schema ?? null);
    applyGhost();
  }, [schema, mode, applyGhost]);

  // Re-apply (or clear) the ghost zone when the bodyHints toggle changes.
  // No mode guard needed: applyGhost no-ops when ghost is null (response mode).
  useEffect(() => { applyGhost(); }, [prefs.bodyHints, applyGhost]);

  // Внешние (не пользовательские) обновления контролируемого value — например
  // Reset-to-template — обёртка Monaco применяет к модели программно и НЕ
  // прокидывает в onChange. Ловим расхождение value с последним текстом,
  // который видел handleChange, и пересинхронизируем tree/ghost.
  useEffect(() => {
    const l = live.current;
    if (mode !== "request" || !l || value === l.lastText) return;
    l.lastText = value;
    const parsed = parseWithSpans(value);
    l.tree = parsed?.tree ?? null;
    l.spans = parsed?.spans ?? [];
    l.lineCount = value.split("\n").length;
    applyGhost();
  }, [value, mode, applyGhost]);

  // Clear the model's schema entry (and contract markers) when BodyView unmounts.
  useEffect(
    () => () => {
      const l = live.current;
      const model = l?.editor.getModel();
      setModelSchema(model ?? null, null);
      if (l && model) l.monaco.editor.setModelMarkers(model, "hs-contract", []);
    },
    [],
  );

  // Request: refresh tree/spans from the user's text on each edit.
  const handleChange = useCallback(
    (next: string | undefined) => {
      const v = next ?? "";
      if (mode === "request" && live.current) {
        live.current.lastText = v;
        const parsed = parseWithSpans(v);
        live.current.tree = parsed?.tree ?? null;
        live.current.spans = parsed?.spans ?? [];
        // Line-structure edits (Enter / paste / line deletion) displace the zone's
        // anchor: Monaco only shifts zones when lines are inserted ABOVE them, so
        // the caret line Enter creates at the anchor boundary would sit below the
        // stale zone for the debounce duration — a visible caret jump. Re-anchor
        // synchronously (same task as the edit, before the next paint); plain
        // same-line typing keeps the flicker-damping debounce.
        const lineCount = v.split("\n").length;
        if (lineCount !== live.current.lineCount) {
          live.current.lineCount = lineCount;
          applyGhost();
        } else {
          scheduleGhost(150);
        }
      }
      onChange?.(v);
    },
    [mode, onChange, applyGhost, scheduleGhost],
  );

  const options = mode === "response" ? BODY_READONLY_OPTIONS : BODY_EDIT_OPTIONS;
  // Response model text is derived (pretty/elided) and set imperatively in onMount;
  // pass the raw value only as the initial Monaco value, then never via React again
  // for response (so prop-sync doesn't clobber the rendered text). Keyed remount on
  // value change keeps it simple and correct.
  const key = useMemo(() => (mode === "response" ? value : "request"), [mode, value]);

  return (
    <Suspense fallback={<div className="h-full w-full bg-background" aria-hidden />}>
      <MonacoEditor
        key={key}
        height="100%"
        defaultLanguage="json-with-vars"
        theme={MONACO_THEME}
        value={value}
        onChange={mode === "request" ? handleChange : undefined}
        onMount={onMount}
        options={options}
        loading={null}
      />
    </Suspense>
  );
}
