import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn().mockResolvedValue(null),
  open: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/ipc/client", () => ({
  ipc: {
    bundleExport: vi.fn(),
    bundleImportInspect: vi.fn(),
    bundleImportApply: vi.fn(),
    // CatalogProvider mounts useCatalogTree → reload() on mount.
    collectionList: vi.fn().mockResolvedValue([]),
    collectionUpsert: vi.fn().mockResolvedValue(undefined),
    collectionGet: vi.fn().mockResolvedValue(undefined),
  },
}));

import { CatalogProvider } from "@/features/catalog/CatalogProvider";
import { ImportExportPane } from "./ImportExportPane";

describe("ImportExportPane", () => {
  it("renders Export and Import actions + the non-destructive note", async () => {
    render(
      <CatalogProvider>
        <ImportExportPane />
      </CatalogProvider>,
    );
    // CatalogProvider's mount effect awaits ipc.collectionList() and then sets tree +
    // loading; let those land inside the test rather than after teardown, outside act().
    expect(await screen.findByRole("button", { name: /^export$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^import$/i })).toBeInTheDocument();
    expect(screen.getByText(/nothing is deleted/i)).toBeInTheDocument();
  });
});
