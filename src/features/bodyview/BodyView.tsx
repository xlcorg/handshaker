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
import { setModelSchema, computeSuggestions, collectPresentKeys, setModelVarCandidates } from "./completion";
import { openVarToken, filterCandidates } from "@/features/vars/varContext";
import type { VarCandidate } from "@/features/vars/candidates";
import { GhostZone, computeGhostLines } from "./ghost";
import { computeUnknownFieldMarkers } from "./validate";
import { attachDecodeActions, type DecodeEditorLike } from "./decodeActions";
import { copyToClipboard } from "@/lib/clipboard";
import { toastSnippet } from "./copyValue";
import { base64Save, base64SaveEncoded } from "@/ipc/client";
import { toast } from "sonner";
import { installContextMenuCleanup } from "./contextMenuCleanup";
import { copyDecodedBase64 } from "./copyDecoded";
import { attachFoldActions, type FoldMenuEditor } from "./foldActions";
import { shouldShowMinimap, minimapToggleOptions } from "./minimapGate";

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
  /** Variable candidates for `{{`-autocomplete — request mode only. */
  varCandidates?: VarCandidate[];
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
  decode: DisposableLike | null;
  /** Collapse/Expand-all context-menu actions (response only). */
  fold: DisposableLike | null;
  typeSub: DisposableLike | null;
  ghost: GhostZone | null;
  ghostTimer: number | null;
  /** Line count after the last edit — a change means the ghost anchor moved. */
  lineCount: number;
  /** Last text seen by handleChange / mount — used to detect external value updates. */
  lastText: string;
  /** Whether the minimap is currently enabled (response only) — guards the
   *  size-gate so toggling it never loops with the layout-change listener. */
  minimapOn: boolean;
  /** Disposables for the size-gate listeners (response only). */
  minimapSubs: DisposableLike[];
}

export function BodyView({ mode, value, onChange, onSubmit, schema, varCandidates }: BodyViewProps) {
  const [prefs] = usePrefs();
  const live = useRef<Live | null>(null);
  // Ref so the Monaco command (bound once in onMount) always calls the freshest handler.
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;
  const schemaRef = useRef(schema);
  schemaRef.current = schema;
  const varCandidatesRef = useRef(varCandidates);
  varCandidatesRef.current = varCandidates;

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
      live.current?.decode?.dispose();
      live.current?.fold?.dispose();
      live.current?.typeSub?.dispose();
      live.current?.minimapSubs?.forEach((d) => d.dispose());
      live.current = {
        editor, monaco, tree: null, spans: [], badges: [],
        decorations: null, expanded: new Set(), controller: null, decode: null, fold: null, typeSub: null,
        ghost: null, ghostTimer: null,
        lineCount: editor.getModel()?.getLineCount() ?? 1,
        lastText: editor.getValue(),
        minimapOn: false,
        minimapSubs: [],
      };
      // Drop Monaco's default "Command Palette" entry from the right-click menu
      // (F1 still opens it). In the read-only response viewer, also drop the
      // built-in "Copy" — our "Copy value" replaces it (Ctrl+C still copies).
      installContextMenuCleanup(editor, { stripCopy: mode === "response" });
      // Attach schema to the model (request mode is the only consumer:
      // autocomplete + ghost + unknown-field markers; response passes none).
      setModelSchema(editor.getModel(), schemaRef.current ?? null);
      setModelVarCandidates(editor.getModel(), varCandidatesRef.current ?? null);
      if (mode === "request") {
        // Postman-style: opening a quote (a key or a value string) force-opens the
        // suggest widget. Monaco does NOT auto-trigger completion inside strings
        // (quickSuggestions / trigger-char gating differs by token context), so we
        // trigger it explicitly. `browserEvent.key` is the produced character, so this
        // is layout-independent. We only trigger when there's actually something to
        // suggest at the caret — otherwise Monaco shows a noisy "No suggestions" popup
        // on every value quote of a free-form string field.
        live.current.typeSub = editor.onKeyUp((e) => {
          const key = e.browserEvent.key;
          if (key !== '"' && key !== "{") return;
          const model = editor.getModel();
          const pos = editor.getPosition();
          if (!model || !pos) return;
          const textBefore = model.getValueInRange({
            startLineNumber: 1, startColumn: 1,
            endLineNumber: pos.lineNumber, endColumn: pos.column,
          });
          // Variable token: open the widget if `{{…` and candidates match.
          const tok = openVarToken(textBefore);
          const vc = varCandidatesRef.current;
          if (tok && vc && filterCandidates(vc, tok.partial).length > 0) {
            editor.trigger("autocomplete", "editor.action.triggerSuggest", {});
            return;
          }
          // Schema path (quote open) — unchanged behaviour.
          if (key !== '"') return;
          const sc = schemaRef.current;
          if (!sc) return;
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
      // Size-gate the minimap in BOTH editors (request + response) for a uniform
      // large-body experience: the minimap appears only when content overflows the
      // viewport and, when shown, replaces the redundant vertical scrollbar (see
      // minimapToggleOptions) — short bodies / tall panes stay strip-free with a
      // plain scrollbar. Re-evaluated on content growth (typing / badge-expand) and
      // pane resize; the minimapOn guard makes updateOptions a no-op when unchanged.
      const syncMinimap = () => {
        const l = live.current;
        if (!l) return;
        const want = shouldShowMinimap(l.editor.getContentHeight(), l.editor.getLayoutInfo().height);
        if (want === l.minimapOn) return;
        l.minimapOn = want;
        l.editor.updateOptions(minimapToggleOptions(want));
      };
      live.current.minimapSubs = [
        editor.onDidContentSizeChange(syncMinimap),
        editor.onDidLayoutChange(syncMinimap),
      ];
      syncMinimap();
      if (mode === "response") {
        // `v` is the FULL value from the JSON tree (the editor display may be
        // elided), so decode/save always operate on the complete value.
        const reportSave = (run: Promise<string | null>) =>
          void run
            .then((p) => {
              if (p) toast.success(`Saved to ${p}`);
            })
            .catch((e) => toast.error(typeof e === "string" ? e : "Couldn't save"));
        live.current.decode = attachDecodeActions(editor as unknown as DecodeEditorLike, {
          getTree: () => live.current?.tree ?? null,
          getSpans: () => live.current?.spans ?? [],
          onCopyDecoded: (v) => {
            void copyDecodedBase64(v);
          },
          onCopyValue: (v) => {
            void copyToClipboard(v, `Copied: ${toastSnippet(v)}`);
          },
          onSaveDecoded: (v) => reportSave(base64Save(v)),
          onSaveBase64: (v) => reportSave(base64SaveEncoded(v)),
        });
        // Collapse all / Expand all live in the right-click menu (document-wide
        // fold actions), beside the decode/copy items.
        live.current.fold = attachFoldActions(editor as unknown as FoldMenuEditor);
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
        const submit = () => onSubmitRef.current?.();
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, submit);
        // Ctrl/Cmd+R is the alternate Send chord. Binding it as an editor command
        // both fires Send when the editor has focus AND lets Monaco preventDefault
        // the WebView's reload (the window-level listener can't see it while Monaco
        // holds the key). Same focus-scoped, last-wins reasoning as Enter above, so
        // it's likewise gated to the request editor (onSubmit present).
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyR, submit);
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
    live.current?.decode?.dispose();
    live.current?.fold?.dispose();
    live.current?.typeSub?.dispose();
    if (live.current?.ghostTimer != null) window.clearTimeout(live.current.ghostTimer);
    live.current?.ghost?.dispose();
    live.current?.minimapSubs?.forEach((d) => d.dispose());
  }, []);

  // Keep the model's attached schema current as the selected method changes.
  // Only request mode receives a schema (autocomplete + ghost + markers);
  // response mode's schema is always null/undefined, and applyGhost self-gates
  // on l.ghost (never created in response mode), so this runs unconditionally.
  useEffect(() => {
    const model = live.current?.editor.getModel();
    setModelSchema(model ?? null, schema ?? null);
    setModelVarCandidates(model ?? null, varCandidates ?? null);
    applyGhost();
  }, [schema, varCandidates, mode, applyGhost]);

  // Re-apply (or clear) the ghost zone when the bodyHints toggle changes.
  // No mode guard needed: applyGhost no-ops when ghost is null (response mode).
  useEffect(() => { applyGhost(); }, [prefs.bodyHints, applyGhost]);

  // External (non-user) updates to the controlled value — e.g. Reset-to-template —
  // are applied to the Monaco model programmatically by the wrapper and do NOT
  // fire onChange. Catch the divergence between value and the last text seen by
  // handleChange, and re-sync tree/ghost.
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
      setModelVarCandidates(model ?? null, null);
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

  // wordWrap — источник истины prefs.wordWrap (общий для запроса и ответа), поэтому
  // переопределяем базовую опцию здесь; base-консты в monaco.ts остаются как есть.
  // Смена prefs.wordWrap меняет идентичность options → @monaco-editor/react применяет
  // updateOptions на смонтированном редакторе (живое переключение, без ремаунта).
  // Default off → длинное значение не уходит «башней» под ключ (см. spec 2026-06-16).
  const base = mode === "response" ? BODY_READONLY_OPTIONS : BODY_EDIT_OPTIONS;
  const options = useMemo(
    () => ({ ...base, wordWrap: (prefs.wordWrap ? "on" : "off") as "on" | "off" }),
    [base, prefs.wordWrap],
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
