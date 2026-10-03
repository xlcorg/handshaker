import { Download } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { compactFocusRing } from "@/lib/focusRing";
import { cn } from "@/lib/cn";
import { messages } from "@/lib/messages";
import { isMacOS } from "@/lib/platform";
import { assembleStreamFile, canExport, saveStreamMessages } from "./exportActions";
import type { StreamEntry } from "./streamStore";

/** The toolbar's `actions` slot: an icon opening the export menu — **Save messages to
 *  file…** (= Ctrl/Cmd+S) and, per the response type's `bytes` candidates
 *  (`entry.bytesFields`, computed by core at Open), **Assemble file from `<path>`…** —
 *  one item for a single candidate, a submenu with one item per path for several, nothing
 *  for none. Every item is enabled only in a terminal state (End OK / non-OK, Cancel),
 *  never while the call is open or half-closed. */
export function StreamExportMenu({ entry }: { entry: StreamEntry }) {
  const t = messages.stream.export;
  const ready = canExport(entry);
  const fields = entry.bytesFields;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t.menuAria}
          title={t.menuAria}
          className={cn(
            "flex size-6 flex-none items-center justify-center rounded-md text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            compactFocusRing,
          )}
        >
          <Download className="size-3.5" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuItem disabled={!ready} onSelect={() => void saveStreamMessages(entry.id)}>
          <span className="flex-1">{t.saveMessages}</span>
          <DropdownMenuShortcut aria-hidden>{isMacOS ? "⌘S" : "Ctrl+S"}</DropdownMenuShortcut>
        </DropdownMenuItem>
        {fields.length === 1 && (
          <DropdownMenuItem disabled={!ready} onSelect={() => void assembleStreamFile(entry, fields[0])}>
            {t.assembleFrom(fields[0])}
          </DropdownMenuItem>
        )}
        {fields.length > 1 && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={!ready}>{t.assembleSubmenu}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {fields.map((path) => (
                <DropdownMenuItem key={path} disabled={!ready} onSelect={() => void assembleStreamFile(entry, path)}>
                  {t.assembleFrom(path)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
