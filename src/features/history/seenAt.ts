const firstSeen = new Map<string, number>();

export function seenAt(id: string): number {
  const existing = firstSeen.get(id);
  if (existing !== undefined) return existing;
  const now = Date.now();
  firstSeen.set(id, now);
  return now;
}
