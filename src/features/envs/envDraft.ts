declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type RowId = Brand<string, "RowId">;

export type EnvName = Brand<string, "EnvName">;

export type ColorKey = Brand<string, "ColorKey">;

export type Variable = readonly [key: string, value: string];

export interface OpenEnv {
  readonly name: EnvName;
  readonly color: ColorKey | null;
  readonly variables: readonly Variable[];
  readonly index: number;
}

export interface EnvSummary {
  readonly name: EnvName;
}

export function storedName(name: string): EnvName {
  return name as EnvName;
}

export function colorKey(key: string): ColorKey {
  return key as ColorKey;
}

export interface DraftRow {
  readonly id: RowId;
  readonly key: string;
  readonly value: string;
}

export interface EnvDraft {
  readonly name: string;
  readonly color: ColorKey | null;
  readonly rows: readonly DraftRow[];
}

export type NameIssue = "empty" | "taken";
export type RowIssue = "empty" | "duplicate";

export interface DraftIssues {
  readonly name: NameIssue | null;
  readonly rows: ReadonlyMap<RowId, RowIssue>;
}

declare const goalBrand: unique symbol;

export interface EnvGoal {
  readonly name: EnvName;
  readonly color: ColorKey | null;
  readonly variables: readonly Variable[];
  readonly [goalBrand]: true;
}

export type ParsedDraft =
  | { readonly ok: true; readonly goal: EnvGoal }
  | { readonly ok: false; readonly issues: DraftIssues };

export function parseDraft(
  draft: EnvDraft,
  taken: ReadonlySet<string>,
): ParsedDraft {
  const name: NameIssue | null =
    draft.name === "" ? "empty" : taken.has(draft.name) ? "taken" : null;
  const rows = new Map<RowId, RowIssue>();
  const byKey = new Map<string, RowId[]>();
  for (const row of draft.rows) {
    if (row.key === "") {
      rows.set(row.id, "empty");
      continue;
    }
    const ids = byKey.get(row.key);
    if (ids) ids.push(row.id);
    else byKey.set(row.key, [row.id]);
  }
  for (const ids of byKey.values()) {
    if (ids.length > 1) for (const id of ids) rows.set(id, "duplicate");
  }
  if (name !== null || rows.size > 0)
    return { ok: false, issues: { name, rows } };
  const variables: readonly Variable[] = draft.rows.map((row) => [
    row.key,
    row.value,
  ]);
  return {
    ok: true,
    goal: {
      name: draft.name as EnvName,
      color: draft.color,
      variables,
    } as EnvGoal,
  };
}

export function goalFromStored(env: OpenEnv): EnvGoal {
  return {
    name: env.name,
    color: env.color,
    variables: env.variables,
  } as EnvGoal;
}

export function mintRowId(seq: number): {
  readonly id: RowId;
  readonly seq: number;
} {
  return { id: `r${seq}` as RowId, seq: seq + 1 };
}

export function draftFromStored(
  env: OpenEnv | null,
  seq: number,
): { readonly draft: EnvDraft; readonly seq: number } {
  let next = seq;
  const rows = (env?.variables ?? []).map(([key, value]): DraftRow => {
    const minted = mintRowId(next);
    next = minted.seq;
    return { id: minted.id, key, value };
  });
  return {
    draft: { name: env?.name ?? "", color: env?.color ?? null, rows },
    seq: next,
  };
}
