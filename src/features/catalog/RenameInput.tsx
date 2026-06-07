import { useState } from "react";

import { Input } from "@/components/ui/input";

export interface RenameInputProps {
  initial: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}

/** Inline rename field: autofocus+select, Enter/blur = commit (trimmed, non-empty, changed),
 *  Esc = cancel. Clicks are stopped so they don't bubble to the row's open handler. */
export function RenameInput({ initial, onCommit, onCancel }: RenameInputProps) {
  const [value, setValue] = useState(initial);

  const commit = () => {
    const v = value.trim();
    if (v && v !== initial) onCommit(v);
    else onCancel();
  };

  return (
    <Input
      autoFocus
      value={value}
      aria-label="rename-input"
      onFocus={(e) => e.currentTarget.select()}
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
      className="h-6 min-w-0 flex-1 px-1 text-xs"
    />
  );
}
