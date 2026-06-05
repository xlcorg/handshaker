import { useEffect, useRef, useState } from "react";

export interface RenameInputProps {
  initial: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}

/** Inline rename field: autofocus+select, Enter/blur = commit (trimmed, non-empty, changed),
 *  Esc = cancel. Clicks are stopped so they don't bubble to the row's open handler. */
export function RenameInput({ initial, onCommit, onCancel }: RenameInputProps) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const commit = () => {
    const v = value.trim();
    if (v && v !== initial) onCommit(v);
    else onCancel();
  };

  return (
    <input
      ref={ref}
      value={value}
      aria-label="rename-input"
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      className="h-5 min-w-0 flex-1 rounded border border-border bg-background px-1 text-xs"
    />
  );
}
