import type { CatalogService } from "./model";

export interface FuzzyResult {
  matched: boolean;
  score: number; // higher is better; 0 when query is empty
  indices: number[]; // matched char positions in the target
}

const WORD_BOUNDARY = ".:/_- ";

/**
 * Subsequence fuzzy match with bonuses for prefix, contiguity and word starts.
 * An empty query matches everything with score 0.
 */
export function fuzzyMatch(query: string, target: string): FuzzyResult {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (q.length === 0) return { matched: true, score: 0, indices: [] };

  const indices: number[] = [];
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    let found = -1;
    for (; ti < t.length; ti++) {
      if (t[ti] === ch) {
        found = ti;
        break;
      }
    }
    if (found < 0) return { matched: false, score: 0, indices: [] };
    indices.push(found);
    score += 1; // base point per matched char
    if (found === prev + 1) score += 5; // contiguity
    if (found === 0) score += 8; // prefix
    else if (WORD_BOUNDARY.includes(t[found - 1])) score += 3; // word start
    prev = found;
    ti = found + 1;
  }
  score += Math.max(0, 5 - (t.length - q.length) / 4); // prefer tighter targets
  return { matched: true, score, indices };
}

export interface RankedService {
  service: CatalogService;
  score: number;
  indices: number[]; // label match indices (for optional highlighting)
}

/** Rank services by fuzzy match on label (falling back to address); favorites break ties. */
export function rankServices(query: string, services: CatalogService[]): RankedService[] {
  const ranked: RankedService[] = [];
  for (const service of services) {
    const onLabel = fuzzyMatch(query, service.label);
    const onAddr = fuzzyMatch(query, service.address);
    if (!onLabel.matched && !onAddr.matched) continue;
    const best = onLabel.score >= onAddr.score ? onLabel : onAddr;
    let score = best.score;
    if (service.favorite) score += 2;
    ranked.push({ service, score, indices: onLabel.matched ? onLabel.indices : [] });
  }
  return ranked.sort(
    (a, b) => b.score - a.score || a.service.label.localeCompare(b.service.label),
  );
}
