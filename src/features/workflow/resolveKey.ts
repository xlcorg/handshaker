declare const brand: unique symbol;

/** Active-env effect identity. Only `resolveKey` can build one. */
export type ResolveKey = string & { readonly [brand]: "ResolveKey" };

/**
 * The only builder of a `ResolveKey`. Call, HTTP, and the collection overview
 * each pass the same parts; only the overview passes `unsavedVars`.
 *
 * The call and HTTP shapes stay `collectionId|envName|envRevision`. The
 * overview appends the unsaved collection vars.
 */
export function resolveKey(parts: {
  collectionId: string | null;
  envName: string | null;
  envRevision: number;
  unsavedVars?: Readonly<Record<string, string>>;
}): ResolveKey {
  const unsaved =
    parts.unsavedVars === undefined
      ? ""
      : `|${JSON.stringify(parts.unsavedVars)}`;
  // prettier-ignore
  const raw = `${parts.collectionId ?? ""}|${parts.envName ?? ""}|${parts.envRevision}${unsaved}`;
  return raw as ResolveKey;
}

/**
 * Stable key for a surface that is not tracking an environment. Leaf inputs
 * use it when their host omits the prop. The hooks themselves have no default.
 */
export const idleResolveKey: ResolveKey = resolveKey({
  collectionId: null,
  envName: null,
  envRevision: 0,
});
