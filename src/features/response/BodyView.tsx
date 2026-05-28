import { Suspense } from "react";
import { MonacoEditor, READ_ONLY_OPTIONS, monacoThemeFor } from "@/lib/monaco";
import { usePrefs } from "@/lib/use-prefs";

export interface BodyViewProps {
  json: string;
}

/**
 * Read-only JSON response view. Same Monaco instance as `BodyEditor`,
 * `readOnly: true`. Chunk is preloaded at app boot — Suspense fallback is
 * just a transparent placeholder.
 */
export function BodyView({ json }: BodyViewProps) {
  const [prefs] = usePrefs();
  return (
    <Suspense fallback={<div className="h-full w-full bg-background" aria-hidden />}>
      <MonacoEditor
        height="100%"
        defaultLanguage="json"
        theme={monacoThemeFor(prefs.theme)}
        value={json}
        options={READ_ONLY_OPTIONS}
      />
    </Suspense>
  );
}
