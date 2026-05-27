import { Suspense } from "react";
import { MonacoEditor, EDITOR_OPTIONS, MONACO_THEME } from "@/lib/monaco";

export interface BodyEditorProps {
  value: string;
  onChange: (next: string) => void;
}

/**
 * Request-body editor. Monaco JSON, bundled locally (see `src/lib/monaco.ts`).
 * Lazy-loaded — first render triggers a one-time ~4MB chunk fetch.
 */
export function BodyEditor({ value, onChange }: BodyEditorProps) {
  return (
    <Suspense
      fallback={
        <div className="text-sm text-muted-foreground p-4">Loading editor…</div>
      }
    >
      <MonacoEditor
        height="100%"
        defaultLanguage="json"
        theme={MONACO_THEME}
        value={value}
        onChange={(v) => onChange(v ?? "")}
        options={EDITOR_OPTIONS}
      />
    </Suspense>
  );
}
