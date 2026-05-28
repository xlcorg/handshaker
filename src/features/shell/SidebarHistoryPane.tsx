import { Clock } from "lucide-react";

export function SidebarHistoryPane() {
  return (
    <div className="px-3 py-6 text-xs text-muted-foreground leading-relaxed flex flex-col items-center gap-2 text-center">
      <Clock className="size-5 text-muted-foreground/60" />
      <div className="text-foreground/70">No history yet</div>
      <div>Past requests appear here once a request log is wired up.</div>
    </div>
  );
}
