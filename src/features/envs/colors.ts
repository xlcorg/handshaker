export const ENV_PRESETS = [
  { key: "gray", hex: "#9099A1" },
  { key: "coral", hex: "#FF6B63" },
  { key: "orange", hex: "#FF9F43" },
  { key: "yellow", hex: "#F4D84B" },
  { key: "green", hex: "#43B957" },
  { key: "teal", hex: "#15B8AD" },
  { key: "cyan", hex: "#41C8EC" },
  { key: "blue", hex: "#3D87F5" },
  { key: "indigo", hex: "#7954F6" },
  { key: "purple", hex: "#B654EF" },
  { key: "pink", hex: "#E75B9F" },
  { key: "brown", hex: "#9B6B51" },
] as const;

export type PresetKey = (typeof ENV_PRESETS)[number]["key"];

const PRESET_HEX = Object.fromEntries(
  ENV_PRESETS.map((p) => [p.key, p.hex]),
) as Readonly<Record<PresetKey, string>>;

const LEGACY_HEX = {
  red: "#ef4444",
  orange: "#f97316",
  yellow: "#eab308",
  green: "#22c55e",
  teal: "#14b8a6",
  blue: "#3b82f6",
  indigo: "#6366f1",
  purple: "#a855f7",
  pink: "#ec4899",
  gray: "#9ca3af",
} as const;

type LegacyKey = keyof typeof LEGACY_HEX;

const DERIVE_RING: readonly LegacyKey[] = [
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "indigo",
  "purple",
  "pink",
  "gray",
];

const HEX_LITERAL = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function isPresetKey(raw: string): raw is PresetKey {
  return Object.hasOwn(PRESET_HEX, raw);
}

function isLegacyKey(raw: string): raw is LegacyKey {
  return Object.hasOwn(LEGACY_HEX, raw);
}

function defaultColorKeyForName(name: string): LegacyKey {
  const n = name.trim().toLowerCase();
  if (n.includes("prod")) return "red";
  if (n.includes("local") || n.includes("test")) return "green";
  if (n.includes("stg") || n.includes("stag")) return "yellow";
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  return DERIVE_RING[h % DERIVE_RING.length];
}

export interface Marker {
  readonly paint: string;
  readonly ring: PresetKey | null;
}

export function paintMarker(stored: string | null, name: string): Marker {
  if (stored === null) {
    const key = defaultColorKeyForName(name);
    return { paint: LEGACY_HEX[key], ring: isPresetKey(key) ? key : null };
  }
  if (isPresetKey(stored)) return { paint: PRESET_HEX[stored], ring: stored };
  if (isLegacyKey(stored)) return { paint: LEGACY_HEX[stored], ring: null };
  if (HEX_LITERAL.test(stored)) return { paint: stored, ring: null };
  return { paint: LEGACY_HEX.gray, ring: null };
}
