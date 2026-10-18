import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Tauri compiles a capability that omits a permission the window actually
// calls, and the button then no-ops. These are the grants that had to be
// added after the titlebar shipped: start-dragging, and the window close
// permissions (close, minimize, toggle-maximize, and the internal toggle
// used by double-click on the drag region).
export const START_DRAGGING = "core:window:allow-start-dragging";
export const WINDOW_CLOSE_PERMISSIONS = [
  "core:window:allow-close",
  "core:window:allow-minimize",
  "core:window:allow-toggle-maximize",
  "core:window:allow-internal-toggle-maximize",
] as const;

const REQUIRED = [START_DRAGGING, ...WINDOW_CLOSE_PERMISSIONS];

type PermissionEntry = string | { identifier?: string };

export function permissionIds(capability: unknown): Set<string> {
  const permissions = (capability as { permissions?: unknown } | null)
    ?.permissions;
  if (!Array.isArray(permissions)) return new Set();
  const ids = new Set<string>();
  for (const entry of permissions as PermissionEntry[]) {
    if (typeof entry === "string") ids.add(entry);
    else if (entry && typeof entry.identifier === "string")
      ids.add(entry.identifier);
  }
  return ids;
}

/** Required permission ids that the capability does not grant. */
export function missingRequiredPermissions(capability: unknown): string[] {
  const granted = permissionIds(capability);
  return REQUIRED.filter((id) => !granted.has(id));
}

export function formatMissingPermissions(missing: readonly string[]): string[] {
  const lines: string[] = [];
  if (missing.includes(START_DRAGGING)) lines.push(`missing ${START_DRAGGING}`);
  const close = missing.filter((id) => id !== START_DRAGGING);
  if (close.length > 0)
    lines.push(`missing window close permissions: ${close.join(", ")}`);
  return lines;
}

// CAPABILITY_FILE points the same check at a historical capability file.
const capabilityPath =
  process.env.CAPABILITY_FILE ?? "src-tauri/capabilities/default.json";

describe("default Tauri capability", () => {
  it("grants start-dragging and the window close permissions", () => {
    const capability = JSON.parse(
      readFileSync(capabilityPath, "utf8"),
    ) as unknown;
    const lines = formatMissingPermissions(
      missingRequiredPermissions(capability),
    );
    if (lines.length > 0) {
      throw new Error(`${capabilityPath}\n${lines.join("\n")}`);
    }
  });

  it("counts object-form permission identifiers", () => {
    const capability = {
      permissions: REQUIRED.map((id) => ({ identifier: id })),
    };
    expect(missingRequiredPermissions(capability)).toEqual([]);
  });

  it("reports start-dragging and window close permissions separately", () => {
    expect(
      formatMissingPermissions(
        missingRequiredPermissions({ permissions: ["core:default"] }),
      ),
    ).toEqual([
      `missing ${START_DRAGGING}`,
      `missing window close permissions: ${WINDOW_CLOSE_PERMISSIONS.join(", ")}`,
    ]);
    expect(
      formatMissingPermissions(
        missingRequiredPermissions({
          permissions: [...WINDOW_CLOSE_PERMISSIONS],
        }),
      ),
    ).toEqual([`missing ${START_DRAGGING}`]);
  });
});
