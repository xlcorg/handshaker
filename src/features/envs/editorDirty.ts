import type { EnvironmentIpc } from "@/ipc/bindings";

/** In-dialog draft. Distinct from the persisted env list the parent owns. */
export type EnvEditorDraft = {
  originalName: string | null;
  name: string;
  vars: Record<string, string>;
  pickedColor: string | null;
};

/** Read the target env's variables from the env list. `null` (create mode) ⇒ empty. */
export function loadVars(
  originalName: string | null,
  envs: EnvironmentIpc[],
): Record<string, string> {
  if (originalName === null) return {};
  const cur = envs.find((e) => e.name === originalName);
  const out: Record<string, string> = {};
  if (cur) {
    // Defensive coerce — tauri-specta emits Partial<Record<...>> for HashMap.
    for (const [k, v] of Object.entries(cur.variables)) {
      if (typeof v === "string") out[k] = v;
    }
  }
  return out;
}

/** The env's stored color (edit mode) or null (create mode). */
export function loadColor(originalName: string | null, envs: EnvironmentIpc[]): string | null {
  if (originalName === null) return null;
  return envs.find((e) => e.name === originalName)?.color ?? null;
}

export function isEnvEditorDirty(draft: EnvEditorDraft, envs: EnvironmentIpc[]): boolean {
  const { originalName, name, vars, pickedColor } = draft;
  if (originalName === null) {
    return name.trim() !== "" || Object.keys(vars).length > 0 || pickedColor !== null;
  }
  if (name !== originalName) return true;
  if (pickedColor !== loadColor(originalName, envs)) return true;
  return !varsEqual(vars, loadVars(originalName, envs));
}

function varsEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => a[k] === b[k]);
}
