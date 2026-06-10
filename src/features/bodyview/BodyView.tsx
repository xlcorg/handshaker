import { Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import type * as Monaco from "monaco-editor";
import { MonacoEditor, monacoThemeFor, BODY_EDIT_OPTIONS, BODY_READONLY_OPTIONS } from "@/lib/monaco";
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
import { setModelSchema, computeSuggestions } from "./completion";
import { refreshBodyHints } from "./hints";
import { GhostZone, computeGhostLines } from "./ghost";

type Mode = "request" | "response";

export interface BodyViewProps {
  mode: Mode;
  value: string;
  onChange?: (next: string) => void;
  /** Ctrl/Cmd+Enter inside the editor (Monaco swallows it, so we bind a command). */
  onSubmit?: () => void;
  /** Request mode only: flat field-schema attached to the model for autocomplete. */
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

  // Recompute the ghost skeleton; debounced so per-keystroke edits don't churn zones.
  // Deps intentionally empty: reads live/schemaRef (stable refs) and readPrefs()
  // (module-level read) — nothing closes over React state.
  const scheduleGhost = useCallback((delay: number) => {
    const l = live.current;
    if (!l || !l.ghost) return;
    if (l.ghostTimer !== null) window.clearTimeout(l.ghostTimer);
    l.ghostTimer = window.setTimeout(() => {
      l.ghostTimer = null;
      const sc = schemaRef.current;
      const block =
        readPrefs().bodyHints && sc ? computeGhostLines(l.editor.getValue(), sc) : null;
      // contentLeft sampled at apply-time; gutter-width changes (rare, usually
      // edit-driven) re-sample on the next recompute.
      l.ghost?.apply(block, l.editor.getLayoutInfo().contentLeft);
    }, delay);
  }, []);

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
      };
      if (mode === "request") {
        setModelSchema(editor.getModel(), schemaRef.current ?? null);
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
          if (computeSuggestions(sc, textBefore).length > 0) {
            editor.trigger("autocomplete", "editor.action.triggerSuggest", {});
          }
        });
        live.current.ghost = new GhostZone(editor);
        scheduleGhost(0);
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
    [mode, scheduleGhost],
  );

  // Dispose the controller + type subscriptions when BodyView itself unmounts.
  useEffect(() => () => {
    live.current?.controller?.dispose();
    live.current?.typeSub?.dispose();
    if (live.current?.ghostTimer != null) window.clearTimeout(live.current.ghostTimer);
    live.current?.ghost?.dispose();
  }, []);

  // Keep the model's attached schema current as the selected method changes.
  useEffect(() => {
    if (mode !== "request") return;
    const model = live.current?.editor.getModel();
    setModelSchema(model ?? null, schema ?? null);
    refreshBodyHints();
    scheduleGhost(0);
  }, [schema, mode, scheduleGhost]);

  // Re-apply (or clear) the ghost zone when the bodyHints toggle changes.
  // No mode guard needed: scheduleGhost no-ops when ghost is null (response mode).
  useEffect(() => { scheduleGhost(0); }, [prefs.bodyHints, scheduleGhost]);

  // Clear the model's schema entry when BodyView unmounts.
  useEffect(
    () => () => {
      const model = live.current?.editor.getModel();
      setModelSchema(model ?? null, null);
    },
    [],
  );

  // Request: refresh tree/spans from the user's text on each edit.
  const handleChange = useCallback(
    (next: string | undefined) => {
      const v = next ?? "";
      if (mode === "request" && live.current) {
        const parsed = parseWithSpans(v);
        live.current.tree = parsed?.tree ?? null;
        live.current.spans = parsed?.spans ?? [];
        scheduleGhost(150);
      }
      onChange?.(v);
    },
    [mode, onChange, scheduleGhost],
  );

  const options = useMemo(
    () => ({
      ...(mode === "response" ? BODY_READONLY_OPTIONS : BODY_EDIT_OPTIONS),
      // Response editors get no hints until a schema is attached (output side wired later).
      inlayHints: { enabled: prefs.bodyHints ? ("on" as const) : ("off" as const) },
    }),
    [mode, prefs.bodyHints],
  );
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
        theme={monacoThemeFor(prefs.theme)}
        value={value}
        onChange={mode === "request" ? handleChange : undefined}
        onMount={onMount}
        options={options}
        loading={null}
      />
    </Suspense>
  );
}
