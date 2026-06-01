import type { SavedAuthConfigIpc } from "@/ipc/bindings";
import type { AuthEntry } from "./AuthBlock";

/**
 * Map a UI `AuthEntry` to our backend `SavedAuthConfigIpc`.
 *
 * The backend supports only `none | env_var | oauth_2_client_credentials`.
 * `bearer` and `apikey` both round-trip through `env_var`; `basic`/`mtls`
 * have no backend representation and map to `null` — callers MUST treat a
 * `null` result as "clear/unsupported" (persist via `authSetForEnv(..., null)`)
 * rather than silently dropping the change.
 */
export function authEntryToConfig(e: AuthEntry): SavedAuthConfigIpc | null {
  switch (e.type) {
    case "none":
      return { kind: "none" };
    case "bearer":
      return {
        kind: "env_var",
        env_var: e.tokenVar,
        header_name: "authorization",
        prefix: "Bearer ",
      };
    case "apikey":
      return {
        kind: "env_var",
        env_var: e.valueVar,
        header_name: e.headerName || "x-api-key",
        prefix: "",
      };
    case "basic":
    case "mtls":
      // Unsupported by the current backend — not persisted.
      return null;
  }
}

/**
 * Map a backend `SavedAuthConfigIpc` back to a UI `AuthEntry`.
 *
 * `undefined`/`none` → no auth. An `env_var` config whose header is
 * `authorization` with a `Bearer ` prefix surfaces as a bearer token;
 * any other `env_var` surfaces as an API key. OAuth is not surfaced this
 * pass and falls back to `none`.
 */
export function configToAuthEntry(c: SavedAuthConfigIpc | undefined): AuthEntry {
  if (!c || c.kind === "none") return { type: "none" };
  if (c.kind === "env_var") {
    if (c.header_name.toLowerCase() === "authorization" && c.prefix.trim() === "Bearer") {
      return { type: "bearer", tokenVar: c.env_var };
    }
    return { type: "apikey", headerName: c.header_name, valueVar: c.env_var };
  }
  // oauth_2_client_credentials — not surfaced this pass.
  return { type: "none" };
}
