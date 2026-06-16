import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn(), open: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/features/envs/envRevision", () => ({ bumpEnvRevision: vi.fn() }));
vi.mock("@/ipc/client", () => ({
  ipc: { bundleExport: vi.fn(), bundleImportInspect: vi.fn(), bundleImportApply: vi.fn() },
}));

import { save, open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { bumpEnvRevision } from "@/features/envs/envRevision";
import { ipc } from "@/ipc/client";
import { exportBundle, pickAndInspectImport, applyImport } from "./transfer";

beforeEach(() => vi.clearAllMocks());

describe("exportBundle", () => {
  it("writes to the chosen path", async () => {
    (save as ReturnType<typeof vi.fn>).mockResolvedValue("/tmp/x.json");
    await exportBundle("col-1", "x.json");
    expect(ipc.bundleExport).toHaveBeenCalledWith("/tmp/x.json", "col-1");
    expect(toast.success).toHaveBeenCalled();
  });

  it("is a no-op when the save dialog is cancelled", async () => {
    (save as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await exportBundle(null, "all.json");
    expect(ipc.bundleExport).not.toHaveBeenCalled();
  });
});

describe("pickAndInspectImport", () => {
  it("returns path + summary on a picked file", async () => {
    (open as ReturnType<typeof vi.fn>).mockResolvedValue("/tmp/in.json");
    const summary = { collections_total: 1, collections_existing: 0, environments_total: 0, environments_existing: 0 };
    (ipc.bundleImportInspect as ReturnType<typeof vi.fn>).mockResolvedValue(summary);
    const res = await pickAndInspectImport();
    expect(res).toEqual({ path: "/tmp/in.json", summary });
  });

  it("returns null when cancelled", async () => {
    (open as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect(await pickAndInspectImport()).toBeNull();
    expect(ipc.bundleImportInspect).not.toHaveBeenCalled();
  });
});

describe("applyImport", () => {
  it("applies, bumps env revision, toasts", async () => {
    const result = { collections_added: 1, collections_updated: 0, environments_added: 0, environments_updated: 0 };
    (ipc.bundleImportApply as ReturnType<typeof vi.fn>).mockResolvedValue(result);
    const out = await applyImport("/tmp/in.json");
    expect(out).toEqual(result);
    expect(bumpEnvRevision).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
  });
});
