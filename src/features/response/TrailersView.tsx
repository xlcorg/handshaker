export interface TrailersViewProps {
  trailers: Partial<{ [key: string]: string }>;
}

/**
 * Renders gRPC trailing metadata as a key/value list. The `<details>` wrapper
 * from the original implementation is gone — `TrailersView` is now the body of
 * a Tab in `ResponsePanel`.
 */
export function TrailersView({ trailers }: TrailersViewProps) {
  const entries = Object.entries(trailers ?? {});
  if (entries.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground italic">
        No trailers.
      </div>
    );
  }
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 p-3 text-xs font-mono">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="break-all">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
