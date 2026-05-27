import { Suspense } from "react";
import { MonacoEditor, EDITOR_OPTIONS, MONACO_THEME } from "@/lib/monaco";

export interface BodyEditorProps {
  value: string;
  onChange: (next: string) => void;
}

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
