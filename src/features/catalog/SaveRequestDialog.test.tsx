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

describe("SaveRequestDialog — recommendation chip", () => {
  it("shows the recommended full path from the selected collection", () => {
    render(<SaveRequestDialog {...props()} />);
    // first collection = "My APIs"; service NotesApiService → folder "NotesApi"; name "Create"
    expect(screen.getByText(/My APIs\s*\/\s*NotesApi\s*\/\s*Create/)).toBeTruthy();
  });

  it("hides the chip when the draft has no method", () => {
    render(<SaveRequestDialog {...props({ draftMethod: "", draftService: "" })} />);
    expect(screen.queryByText(/Рекомендуем/i)).toBeNull();
  });

  it("'Добавить' adds the recommended folder and saves into it", async () => {
    const p = props();
    render(<SaveRequestDialog {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(p.onCreateFolder).toHaveBeenCalledWith("c1", null, "NotesApi"));
    await waitFor(() =>
      expect(p.onSave).toHaveBeenCalledWith({ collectionId: "c1", parentId: "f-new", name: "Create" }),
    );
  });

  it("'Добавить' reuses an existing folder of the same name (no duplicate)", async () => {
    const withFolder = [col("c1", "My APIs", [folder("nf", "NotesApi")]), col("c2", "Sandbox")];
    const p = props({ collections: withFolder });
    render(<SaveRequestDialog {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(p.onSave).toHaveBeenCalledWith({ collectionId: "c1", parentId: "nf", name: "Create" }),
    );
    expect(p.onCreateFolder).not.toHaveBeenCalled();
  });
});

describe("SaveRequestDialog — contextual New", () => {
  it("labels the button 'New folder in' the selected collection", () => {
    render(<SaveRequestDialog {...props()} />);
    expect(screen.getByRole("button", { name: /New folder in .*My APIs/ })).toBeTruthy();
  });

  it("creates a new folder under the selected collection and saves into it", async () => {
    const p = props();
    render(<SaveRequestDialog {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /New folder in/ }));
    fireEvent.change(screen.getByLabelText("New node name"), { target: { value: "Billing" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(p.onCreateFolder).toHaveBeenCalledWith("c1", null, "Billing"));
    await waitFor(() =>
      expect(p.onSave).toHaveBeenCalledWith({ collectionId: "c1", parentId: "f-new", name: "Create" }),
    );
  });

  it("labels the button 'New collection' when nothing is selected", () => {
    render(<SaveRequestDialog {...props({ collections: [] })} />);
    expect(screen.getByRole("button", { name: /New collection/ })).toBeTruthy();
  });

  it("creates a new collection (pending) and saves into it", async () => {
    const p = props({ collections: [] });
    render(<SaveRequestDialog {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /New collection/ }));
    fireEvent.change(screen.getByLabelText("New node name"), { target: { value: "Fresh" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(p.onCreateCollection).toHaveBeenCalledWith("Fresh"));
    await waitFor(() =>
      expect(p.onSave).toHaveBeenCalledWith({ collectionId: "c-new", parentId: null, name: "Create" }),
    );
  });

  it("does NOT persist a pending folder the user navigated away from (no orphan)", async () => {
    const p = props();
    render(<SaveRequestDialog {...p} />);
    // create a pending folder under My APIs (selects it)
    fireEvent.click(screen.getByRole("button", { name: /New folder in/ }));
    fireEvent.change(screen.getByLabelText("New node name"), { target: { value: "Stray" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    // navigate away: select a different collection's root
    fireEvent.click(screen.getByText("Sandbox"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(p.onSave).toHaveBeenCalledWith({ collectionId: "c2", parentId: null, name: "Create" }),
    );
    expect(p.onCreateFolder).not.toHaveBeenCalled();
  });
});
