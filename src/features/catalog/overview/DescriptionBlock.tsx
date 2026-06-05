import { useEffect, useRef, useState } from "react";
import { Plus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";

interface DescriptionBlockProps {
  text: string;
  onChange: (newText: string) => void;
}

export function DescriptionBlock({ text, onChange }: DescriptionBlockProps) {
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState(text);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (edit && ref.current) ref.current.focus();
  }, [edit]);

  useEffect(() => {
    if (!edit) setDraft(text);
  }, [text, edit]);

  if (edit) {
    return (
      <div className="flex flex-col gap-2">
        <textarea
          ref={ref}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setDraft(text);
              setEdit(false);
            }
          }}
          placeholder="Describe what this collection is for. Markdown supported."
          className="w-full min-h-[104px] rounded-md border border-input bg-background px-3 py-2 text-[12.5px] leading-relaxed resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring placeholder:text-muted-foreground/55"
        />
        <div className="flex items-center gap-2">
          <Button
            size="xs"
            onClick={() => {
              onChange(draft);
              setEdit(false);
            }}
          >
            Save
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              setDraft(text);
              setEdit(false);
            }}
          >
            Cancel
          </Button>
          <span className="ml-auto text-[10.5px] text-muted-foreground/45">Esc to cancel</span>
        </div>
      </div>
    );
  }

  if (!text) {
    return (
      <button
        onClick={() => {
          setDraft("");
          setEdit(true);
        }}
        className="w-full rounded-md border border-dashed border-border/80 px-4 py-5 text-left hover:border-border hover:bg-accent/30 transition-colors group/desc"
      >
        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground/70 group-hover/desc:text-foreground/80">
          <Plus size={12} /> Add a description
        </span>
        <p className="text-[11px] text-muted-foreground/45 mt-0.5">
          Explain what the collection covers, conventions, required variables…
        </p>
      </button>
    );
  }

  return (
    <div className="group/desc relative">
      <p className="text-[12.5px] text-foreground/80 leading-relaxed whitespace-pre-wrap text-pretty pr-8">
        {text}
      </p>
      <Tooltip content="Edit description">
        <button
          onClick={() => {
            setDraft(text);
            setEdit(true);
          }}
          aria-label="Edit description"
          className="absolute top-0 right-0 h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground/45 hover:text-foreground hover:bg-accent opacity-0 group-hover/desc:opacity-100 focus-visible:opacity-100 transition-[opacity,color,background-color]"
        >
          <Pencil size={12} />
        </button>
      </Tooltip>
    </div>
  );
}
