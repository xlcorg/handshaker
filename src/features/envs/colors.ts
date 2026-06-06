/** Fixed 10-color palette for environment markers. `key` is what we persist in
 * Environment.color; `hex` is the rendered swatch. */
export interface EnvColorDef {
  key: string;
  label: string;
  hex: string;
}

export const ENV_COLORS: EnvColorDef[] = [
  { key: "red", label: "Red", hex: "#ef4444" },
  { key: "orange", label: "Orange", hex: "#f97316" },
  { key: "yellow", label: "Yellow", hex: "#eab308" },
  { key: "green", label: "Green", hex: "#22c55e" },
  { key: "teal", label: "Teal", hex: "#14b8a6" },
  { key: "blue", label: "Blue", hex: "#3b82f6" },
  { key: "indigo", label: "Indigo", hex: "#6366f1" },
  { key: "purple", label: "Purple", hex: "#a855f7" },
  { key: "pink", label: "Pink", hex: "#ec4899" },
  { key: "gray", label: "Gray", hex: "#9ca3af" },
];

const BY_KEY = new Map(ENV_COLORS.map((c) => [c.key, c]));

/** Stable default color KEY for an env name. Keyword rules first
 * (prod/production→red, local/test→green, stg/staging→yellow), else a stable
 * hash into the palette so every env still gets a consistent, distinct color. */
export function defaultColorKeyForName(name: string): string {
  const n = name.trim().toLowerCase();
  if (n.includes("prod")) return "red";
  if (n.includes("local") || n.includes("test")) return "green";
  if (n.includes("stg") || n.includes("stag")) return "yellow";
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  return ENV_COLORS[h % ENV_COLORS.length].key;
}

/** Resolve an env's effective color key: explicit color, else name default. */
export function resolveColorKey(env: { name: string; color: string | null }): string {
  return env.color ?? defaultColorKeyForName(env.name);
}

/** Hex for a palette key (falls back to gray for unknown keys). */
export function colorHex(key: string): string {
  return BY_KEY.get(key)?.hex ?? "#9ca3af";
}
