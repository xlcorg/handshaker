import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SaveRequestDialog } from "./SaveRequestDialog";
import type { CollectionIpc, CollectionMetaIpc } from "@/ipc/bindings";

const metas: CollectionMetaIpc[] = [{ id: "c1", name: "My Collection" }];
const collection: CollectionIpc = {
  id: "c1", name: "My Collection", items: [], variables: {}, auth: { kind: "none" },
  default_tls: false, skip_tls_verify: false, pinned: false, description: null, created_at: 0,
};

function props(over = {}) {
  return {
    open: true,
    onOpenChange: vi.fn(),
    metas,
    loadCollection: vi.fn().mockResolvedValue(collection),
    defaultName: "GetX",
    onSave: vi.fn().mockResolvedValue(undefined),
    onCreateCollection: vi.fn().mockResolvedValue("c-new"),
    suggestedPath: ["payments", "PaymentService"],
    existingLocations: [],
    ...over,
  };
}

describe("SaveRequestDialog", () => {
  it("defaults the name to the method and saves to the chosen collection", async () => {
    const p = props();
    render(<SaveRequestDialog {...p} />);
    expect((screen.getByPlaceholderText("My request") as HTMLInputElement).value).toBe("GetX");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await Promise.resolve();
    expect(p.onSave).toHaveBeenCalledWith(
      expect.objectContaining({ collectionId: "c1", parentId: null, name: "GetX" }),
    );
  });

  it("shows the suggested Host > Service path hint", () => {
    render(<SaveRequestDialog {...props()} />);
    expect(screen.getByText(/payments\s*›\s*PaymentService/)).toBeTruthy();
  });

  it("shows where the request is already saved", () => {
    render(
      <SaveRequestDialog
        {...props({
          existingLocations: [
            { collectionId: "c1", collectionName: "My Collection", folderPath: ["api"], requestId: "r0", requestName: "GetX" },
          ],
        })}
      />,
    );
    expect(screen.getByText(/Already saved in/i)).toBeTruthy();
    // "My Collection" also appears in the Collection <option>, so scope to the saved-copy list entry.
    expect(screen.getByText(/My Collection\s*›\s*api/)).toBeTruthy();
  });
});
