import { Suspense } from "react";
import { EDITOR_OPTIONS, MonacoEditor, monacoThemeFor } from "@/lib/monaco";
import { usePrefs } from "@/lib/use-prefs";

export interface BodyEditorProps {
  value: string;
  onChange: (next: string) => void;
}

/**
 * Request-body editor. Monaco JSON, bundled locally (see `src/lib/monaco.ts`).
 * The Monaco chunk is preloaded at app boot from `main.tsx`, so the Suspense
 * fallback below is just a transparent placeholder that keeps layout stable —
 * not a visible "loading…" UI.
 */
export function BodyEditor({ value, onChange }: BodyEditorProps) {
  const [prefs] = usePrefs();
  return (
    <Suspense fallback={<div className="h-full w-full bg-background" aria-hidden />}>
      <MonacoEditor
        height="100%"
        defaultLanguage="json-with-vars"
        theme={monacoThemeFor(prefs.theme)}
        value={value}
        onChange={(v) => onChange(v ?? "")}
        options={EDITOR_OPTIONS}
        loading={null}
      />
    </Suspense>
  );
}
