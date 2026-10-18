import { useState } from "react";

/**
 * Local edit state for a form that persists on change.
 *
 * Reseed runs only when `seedKey` changes (the collection identity). A new
 * `server` value with the same key — a persist→reload echo — does not replace
 * the edit. Normalization stays in `toEdit` and the persist mapper.
 */
export function useEditBuffer<S, E>(
  seedKey: string,
  server: S,
  toEdit: (server: S) => E,
): [E, (next: E) => void] {
  const [slot, setSlot] = useState(() => ({
    key: seedKey,
    edit: toEdit(server),
  }));

  const setEdit = (next: E) => {
    setSlot({ key: seedKey, edit: next });
  };

  if (slot.key !== seedKey) {
    const edit = toEdit(server);
    setSlot({ key: seedKey, edit });
    return [edit, setEdit];
  }

  return [slot.edit, setEdit];
}
