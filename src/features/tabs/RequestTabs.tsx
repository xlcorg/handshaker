import { Plus, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Tooltip } from "@/components/ui/tooltip";
import { tabLabel, type RequestTabState } from "./tabModel";

interface RequestTabsProps {
  tabs: RequestTabState[];
  activeId: string;
  onActivate: (id: string) => void;
  onClose: (t: RequestTabState) => void;
  onNew: () => void;
}

export function RequestTabs({ tabs, activeId, onActivate, onClose, onNew }: RequestTabsProps) {
  return (
    <div className="h-9 flex-none flex items-stretch border-b border-border bg-card/50 relative z-30 select-none">
      {/* Scrollable tab list */}
      <div className="flex items-stretch overflow-x-auto scroll-hide min-w-0">
        {tabs.map((tab) => {
          const isActive = tab.id === activeId;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => onActivate(tab.id)}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  onClose(tab);
                }
              }}
              className={cn(
                "group/tab relative flex items-center gap-2 pl-3 pr-1.5 h-full min-w-[132px] max-w-[210px] border-r border-border cursor-pointer transition-colors",
                isActive ? "bg-background" : "bg-transparent hover:bg-accent/40",
              )}
            >
              {/* Active top bar */}
              {isActive && (
                <span className="absolute left-0 right-0 top-0 h-[1.5px] bg-foreground" />
              )}

              {/* Leading plus glyph when no method selected */}
              {!tab.selected && (
                <Plus size={11} className="text-muted-foreground/70 flex-none" />
              )}

              {/* Tab label */}
              <span
                className={cn(
                  "truncate flex-1 text-[12px] font-mono",
                  isActive
                    ? "text-foreground"
                    : "text-muted-foreground group-hover/tab:text-foreground",
                )}
              >
                {tabLabel(tab)}
              </span>

              {/* Close button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab);
                }}
                className={cn(
                  "group/close h-5 w-5 flex-none inline-flex items-center justify-center rounded hover:bg-accent text-muted-foreground/70 hover:text-foreground",
                  isActive || tab.draft.dirty
                    ? "opacity-100"
                    : "opacity-0 group-hover/tab:opacity-100",
                )}
              >
                {tab.draft.dirty ? (
                  <>
                    <span className="h-[7px] w-[7px] rounded-full bg-foreground/80 group-hover/close:hidden" />
                    <X size={11} className="hidden group-hover/close:block" />
                  </>
                ) : (
                  <X size={11} />
                )}
              </button>
            </div>
          );
        })}
      </div>

      {/* New tab button */}
      <Tooltip content="New request" side="bottom">
        <button
          type="button"
          onClick={onNew}
          className="flex-none h-full w-9 inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent/50 border-r border-border transition-colors"
        >
          <Plus size={14} />
        </button>
      </Tooltip>
    </div>
  );
}
