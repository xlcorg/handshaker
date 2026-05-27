export interface BodyViewProps {
  json: string;
}

/**
 * Read-only JSON response view. Plain `<pre>` for now — see BodyEditor for
 * the rationale on deferring Monaco.
 */
export function BodyView({ json }: BodyViewProps) {
  return (
    <pre className="w-full h-full overflow-auto bg-background text-foreground font-mono text-sm p-3 whitespace-pre-wrap break-words">
      {json}
    </pre>
  );
}
