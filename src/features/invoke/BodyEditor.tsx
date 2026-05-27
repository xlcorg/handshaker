export interface BodyEditorProps {
  value: string;
  onChange: (next: string) => void;
}

/**
 * Request-body editor. Plain `<textarea>` for now — Monaco was specified, but
 * the `@monaco-editor/react` default loader fetches Monaco AMD modules from a
 * CDN at runtime, which is brittle inside Tauri's webview (silent failures
 * with no visible error). Bundling Monaco locally is a separate sub-plan.
 */
export function BodyEditor({ value, onChange }: BodyEditorProps) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
      className="w-full h-full resize-none bg-background text-foreground font-mono text-sm p-3 outline-none focus:ring-0 border-0"
      placeholder="{}"
    />
  );
}
