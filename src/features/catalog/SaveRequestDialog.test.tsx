import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SaveRequestDialog } from "./SaveRequestDialog";
import type { CollectionIpc, ItemIpc } from "@/ipc/bindings";

function folder(id: string, name: string, items: ItemIpc[] = []): ItemIpc {
  return { type: "folder", id, name, items };
}
function col(id: string, name: string, items: ItemIpc[] = []): CollectionIpc {
  return {
    id, name, items, variables: {}, auth: { kind: "none" },
    default_tls: false, skip_tls_verify: false, pinned: false, description: null, created_at: 0,
  };
}

const collections = [col("c1", "My APIs", [folder("f1", "Staging")]), col("c2", "Sandbox")];

function props(over = {}) {
  return {
    open: true,
    onOpenChange: vi.fn(),
    collections,
    defaultName: "Create",
    draftService: "notes.v1.NotesApiService",
    draftMethod: "Create",
    onSave: vi.fn().mockResolvedValue(undefined),
    onCreateCollection: vi.fn().mockResolvedValue("c-new"),
    onCreateFolder: vi.fn().mockResolvedValue("f-new"),
    existingLocations: [],
    ...over,
  };
}

describe("SaveRequestDialog — shell", () => {
  it("prefills the name from defaultName", () => {
    render(<SaveRequestDialog {...props()} />);
    expect((screen.getByLabelText("Request name") as HTMLInputElement).value).toBe("Create");
  });

  it("saves to the selected collection root by default (first collection)", async () => {
    const p = props();
    render(<SaveRequestDialog {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(p.onSave).toHaveBeenCalledWith({ collectionId: "c1", parentId: null, name: "Create" }),
    );
  });

  it("saves into a folder the user selects", async () => {
    const p = props();
    render(<SaveRequestDialog {...p} />);
    fireEvent.click(screen.getByLabelText("expand My APIs"));
    fireEvent.click(screen.getByText("Staging"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(p.onSave).toHaveBeenCalledWith({ collectionId: "c1", parentId: "f1", name: "Create" }),
    );
  });

  it("filters the tree via the search box", () => {
    render(<SaveRequestDialog {...props()} />);
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "sandbox" } });
    expect(screen.getByText("Sandbox")).toBeTruthy();
    expect(screen.queryByText("My APIs")).toBeNull();
  });

  it("originBound mode shows only the name field titled 'Update request'", () => {
    render(<SaveRequestDialog {...props({ originBound: true })} />);
    expect(screen.getByText("Update request")).toBeTruthy();
    expect(screen.queryByPlaceholderText(/search/i)).toBeNull();
  });
});
