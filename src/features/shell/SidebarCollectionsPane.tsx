import { Bookmark } from "lucide-react";

export function SidebarCollectionsPane() {
  return (
    <div className="px-3 py-6 text-xs text-muted-foreground leading-relaxed flex flex-col items-center gap-2 text-center">
      <Bookmark className="size-5 text-muted-foreground/60" />
      <div className="text-foreground/70">No saved requests</div>
      <div>Star a request from the response panel to keep it here.</div>
    </div>
  );
}
