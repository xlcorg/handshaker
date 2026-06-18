export type VarOrigin = "env" | "collection";

export interface VarCandidate {
  name: string;
  /** Raw stored value (preview). Never resolved here — instant, no IPC. */
  value: string;
  origin: VarOrigin;
  /** Set on an env candidate that shadows a same-named collection var. */
  overrides?: boolean;
}

type VarMap = Partial<Record<string, string>> | undefined;

/** Active environment wins over a same-named collection var (mirrors resolve order
 *  env > collection). Order: env candidates first, then collection. */
export function buildVarCandidates(env: VarMap, collection: VarMap): VarCandidate[] {
  const envEntries = Object.entries(env ?? {}).filter(
    (e): e is [string, string] => e[1] !== undefined,
  );
  const envNames = new Set(envEntries.map(([k]) => k));
  const collEntries = Object.entries(collection ?? {}).filter(
    (e): e is [string, string] => e[1] !== undefined,
  );
  const collNames = new Set(collEntries.map(([k]) => k));

  const out: VarCandidate[] = [];
  for (const [name, value] of envEntries) {
    out.push(collNames.has(name)
      ? { name, value, origin: "env", overrides: true }
      : { name, value, origin: "env" });
  }
  for (const [name, value] of collEntries) {
    if (envNames.has(name)) continue; // env wins
    out.push({ name, value, origin: "collection" });
  }
  return out;
}
