import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { messages } from "@/lib/messages";
import type { MethodKind } from "@/lib/method-kind";

/** **Method kind** badge (`stream` / `client` / `bidi`) with the kind's colour dot. Unary
 *  and an unknown kind (`null`) render nothing — the UI never claims unary. Shared by the
 *  method picker trigger (catalog / controls kind) and the history row (executed kind). */
export function KindBadge({ kind, className }: { kind: MethodKind | null; className?: string }) {
  if (kind === null || kind === "unary") return null;
  return (
    <Badge variant="secondary" className={cn("font-mono text-[10px] gap-1 px-1.5 py-0 flex-none", className)}>
      <KindDot kind={kind} />
      {messages.methodKind.badge[kind]}
    </Badge>
  );
}

export function KindDot({ kind }: { kind: MethodKind }) {
  const cls =
    kind === "server" ? "bg-stream" :
    kind === "client" ? "bg-warn" :
    kind === "bidi"   ? "bg-kind-bidi" :
                        "bg-muted-foreground/50";
  return <span className={cn("h-1.5 w-1.5 rounded-full flex-none", cls)} aria-hidden />;
}
