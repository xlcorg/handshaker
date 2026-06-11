/**
 * Compute the full new name order after dropping `drag` before/after `target`.
 * Returns `null` when the drop is invalid (unknown names, self-drop) or a
 * no-op (the resulting order equals the current one) — callers skip the IPC
 * round-trip in that case.
 */
export function computeReorder(
  names: string[],
  drag: string,
  target: string,
  zone: "before" | "after",
): string[] | null {
  if (drag === target) return null;
  if (!names.includes(drag)) return null;
  const without = names.filter((n) => n !== drag);
  const targetIdx = without.indexOf(target);
  if (targetIdx < 0) return null;
  const insertAt = zone === "before" ? targetIdx : targetIdx + 1;
  const next = [...without.slice(0, insertAt), drag, ...without.slice(insertAt)];
  return next.some((n, i) => n !== names[i]) ? next : null;
}
