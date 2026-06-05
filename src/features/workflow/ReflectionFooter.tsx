import { RefreshCw } from "lucide-react";

export interface ReflectionFooterProps {
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

/** Status + reload row at the bottom of the draft method dropdown. Mirrors Postman's
 *  "Using server reflection ⟳" — the refresh action lives here, not on the address bar.
 *  The error branch also offers a retry, since failure is when refresh is most wanted. */
export function ReflectionFooter({ loading, error, onRefresh }: ReflectionFooterProps) {
  const refreshButton = (
    <button
      type="button"
      aria-label="Refresh server reflection"
      onClick={onRefresh}
      className="ml-auto inline-flex hover:text-foreground"
    >
      <RefreshCw className="size-3" />
    </button>
  );
  return (
    <div className="flex items-center gap-2 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
      {loading ? (
        <>
          <RefreshCw className="size-3 animate-spin" aria-hidden={true} /> Reflecting…
        </>
      ) : error ? (
        <>
          <span className="truncate text-destructive">{error}</span>
          {refreshButton}
        </>
      ) : (
        <>
          <span className="truncate">Using server reflection</span>
          {refreshButton}
        </>
      )}
    </div>
  );
}
