export interface TrailersViewProps {
  trailers: Partial<Record<string, string>>;
}

export function TrailersView({ trailers }: TrailersViewProps) {
  const entries = (Object.entries(trailers) as [string, string | undefined][]).filter(
    (e): e is [string, string] => e[1] !== undefined,
  );
  if (entries.length === 0) return null;
  return (
    <details className="border-t border-border px-4 py-2 text-sm">
      <summary className="cursor-pointer text-muted-foreground">
        Trailers ({entries.length})
      </summary>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs">
        {entries.map(([k, v]) => (
          <FragmentRow key={k} k={k} v={v} />
        ))}
      </dl>
    </details>
  );
}

function FragmentRow({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="break-all">{v}</dd>
    </>
  );
}
