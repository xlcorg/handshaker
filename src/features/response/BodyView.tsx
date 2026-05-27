import { Suspense } from "react";
import { MonacoEditor, READ_ONLY_OPTIONS, MONACO_THEME } from "@/lib/monaco";

export interface BodyViewProps {
  json: string;
}

/**
 * Read-only JSON response view. Same Monaco instance as `BodyEditor`,
 * `readOnly: true`.
 */
export function BodyView({ json }: BodyViewProps) {
  return (
    <Suspense
      fallback={
        <div className="text-sm text-muted-foreground p-4">Loading viewer…</div>
      }
    >
      <MonacoEditor
        height="100%"
        defaultLanguage="json"
        theme={MONACO_THEME}
        value={json}
        options={READ_ONLY_OPTIONS}
      />
    </Suspense>
  );
}
