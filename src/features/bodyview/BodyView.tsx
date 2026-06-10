import { Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import type * as Monaco from "monaco-editor";
import { MonacoEditor, monacoThemeFor, BODY_EDIT_OPTIONS, BODY_READONLY_OPTIONS } from "@/lib/monaco";
import { usePrefs } from "@/lib/use-prefs";
import { parseWithSpans } from "./parse";
import { renderJsonTree, type Badge } from "./render";
import type { JsonTree } from "./jsonTree";
import type { ValueSpan } from "./spans";
import type { DisposableLike } from "./editorLike";
import { exceedsByteCeiling } from "./elide";
import { attachBodyController } from "./controller";
import { badgeDecorationOptions } from "./badgeDecoration";

type Mode = "request" | "response";

export interface BodyViewProps {
  mode: Mode;
  value: string;
  onChange?: (next: string) => void;
  /** Ctrl/Cmd+Enter inside the editor (Monaco swallows it, so we bind a command). */
  onSubmit?: () => void;
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
}

export function BodyView({ mode, value, onChange, onSubmit }: BodyViewProps) {
  const [prefs] = usePrefs();
  const live = useRef<Live | null>(null);
  // Ref so the Monaco command (bound once in onMount) always calls the freshest handler.
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;

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

  // --- mount -------------------------------------------------------------
  const onMount = useCallback(
    (editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco) => {
      // Keyed remount fires onMount fresh per response value; tear down the
      // prior mount's subscription before attaching a new one.
      live.current?.controller?.dispose();
      live.current = {
        editor, monaco, tree: null, spans: [], badges: [],
        decorations: null, expanded: new Set(), controller: null,
      };
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
    [mode],
  );

  // Dispose the controller subscription when BodyView itself unmounts.
  useEffect(() => () => { live.current?.controller?.dispose(); }, []);

  // Request: refresh tree/spans from the user's text on each edit.
  const handleChange = useCallback(
    (next: string | undefined) => {
      const v = next ?? "";
      if (mode === "request" && live.current) {
        const parsed = parseWithSpans(v);
        live.current.tree = parsed?.tree ?? null;
        live.current.spans = parsed?.spans ?? [];
      }
      onChange?.(v);
    },
    [mode, onChange],
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
