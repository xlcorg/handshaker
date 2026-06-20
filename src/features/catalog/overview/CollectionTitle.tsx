import { useEffect, useRef, useState } from "react";
import { Pencil, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";

interface CollectionTitleProps {
  name: string;
  onRename: (newName: string) => void;
}

export function CollectionTitle({ name, onRename }: CollectionTitleProps) {
  const [isEdit, setEdit] = useState(false);
  const [draft, setDraft] = useState(name);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEdit && ref.current) {
      ref.current.focus();
      ref.current.select();
    }
  }, [isEdit]);

  useEffect(() => {
    if (!isEdit) setDraft(name);
  }, [name, isEdit]);

  const commit = () => {
    onRename(draft.trim() || name);
    setEdit(false);
  };

  const cancel = () => {
    setDraft(name);
    setEdit(false);
  };

  if (isEdit) {
    return (
      <div className="flex items-center gap-1.5 min-w-0">
        <Input
          ref={ref}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") cancel();
          }}
          className="h-7 text-[14px] font-semibold w-[260px] px-2"
        />
        <Tooltip content="Save (↵)">
          <Button size="icon-sm" className="h-7 w-7" onClick={commit}>
            <Check size={14} />
          </Button>
        </Tooltip>
        <Tooltip content="Cancel (Esc)">
          <Button variant="ghost" size="icon-sm" className="h-7 w-7" onClick={cancel}>
            <X size={14} />
          </Button>
        </Tooltip>
      </div>
    );
  }

  return (
    <button
      onClick={() => setEdit(true)}
      className="group/title inline-flex items-center gap-1.5 min-w-0 rounded px-1 -ml-1 h-7 hover:bg-accent/50 transition-colors"
    >
      <span className="text-[14px] font-semibold tracking-tight truncate">{name}</span>
      <Pencil
        size={12}
        className="flex-none text-muted-foreground/0 group-hover/title:text-muted-foreground/70 transition-colors"
      />
    </button>
  );
}
