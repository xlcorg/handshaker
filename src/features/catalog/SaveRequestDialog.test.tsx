import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SaveRequestDialog } from "./SaveRequestDialog";
import type { CollectionIpc, ItemIpc } from "@/ipc/bindings";

function folder(id: string, name: string, items: ItemIpc[] = []): ItemIpc {
  return { type: "folder", id, name, items, expanded: false };
}
function col(id: string, name: string, items: ItemIpc[] = []): CollectionIpc {
  return {
    id, name, items, variables: {}, auth: { kind: "none" },
    default_tls: false, skip_tls_verify: false, pinned: false, description: null, created_at: 0,
    expanded: false,
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
    // Auto-reveal: My APIs is auto-expanded because c1 is the default selected collection.
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

  it("chip text shows 'New Collection' when collections is empty", () => {
    render(<SaveRequestDialog {...props({ collections: [] })} />);
    expect(screen.getByText(/New Collection\s*\/\s*NotesApi\s*\/\s*Create/)).toBeTruthy();
  });

  it("'Добавить' with no collections creates a new collection + folder and saves into it", async () => {
    const p = props({ collections: [] });
    render(<SaveRequestDialog {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(p.onCreateCollection).toHaveBeenCalledWith("New Collection"));
    await waitFor(() => expect(p.onCreateFolder).toHaveBeenCalledWith("c-new", null, "NotesApi"));
    await waitFor(() =>
      expect(p.onSave).toHaveBeenCalledWith({ collectionId: "c-new", parentId: "f-new", name: "Create" }),
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

  it("offers 'New collection' even when collections already exist", () => {
    render(<SaveRequestDialog {...props()} />);
    expect(screen.getByRole("button", { name: /New collection/ })).toBeTruthy();
  });

  it("creates a new collection while one is already selected, and saves into the new collection", async () => {
    const p = props(); // collections present, c1 selected by default
    render(<SaveRequestDialog {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /New collection/ }));
    fireEvent.change(screen.getByLabelText("New node name"), { target: { value: "Fresh" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(p.onCreateCollection).toHaveBeenCalledWith("Fresh"));
    await waitFor(() =>
      expect(p.onSave).toHaveBeenCalledWith({ collectionId: "c-new", parentId: null, name: "Create" }),
    );
    expect(p.onCreateFolder).not.toHaveBeenCalled();
  });

  it("hides 'New folder' but keeps 'New collection' when there are no collections", () => {
    render(<SaveRequestDialog {...props({ collections: [] })} />);
    expect(screen.queryByRole("button", { name: /New folder/ })).toBeNull();
    expect(screen.getByRole("button", { name: /New collection/ })).toBeTruthy();
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

describe("SaveRequestDialog — pending materialization order", () => {
  it("creates a pending collection, then a folder inside it, then saves with real ids", async () => {
    const onCreateCollection = vi.fn().mockResolvedValue("real-col");
    const onCreateFolder = vi.fn().mockResolvedValue("real-folder");
    const p = props({ collections: [], onCreateCollection, onCreateFolder });
    render(<SaveRequestDialog {...p} />);

    // New collection
    fireEvent.click(screen.getByRole("button", { name: /New collection/ }));
    fireEvent.change(screen.getByLabelText("New node name"), { target: { value: "Acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    // New folder inside it (selection is now the pending collection root)
    fireEvent.click(screen.getByRole("button", { name: /New folder in .*Acme/ }));
    fireEvent.change(screen.getByLabelText("New node name"), { target: { value: "NotesApi" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onCreateCollection).toHaveBeenCalledWith("Acme"));
    await waitFor(() => expect(onCreateFolder).toHaveBeenCalledWith("real-col", null, "NotesApi"));
    await waitFor(() =>
      expect(p.onSave).toHaveBeenCalledWith({
        collectionId: "real-col",
        parentId: "real-folder",
        name: "Create",
      }),
    );
  });

  it("materializes two nested pending folders under a real collection in parent-before-child order", async () => {
    const calls: Array<[string, string | null, string]> = [];
    const onCreateFolder = vi.fn(async (collectionId: string, parentId: string | null, name: string) => {
      calls.push([collectionId, parentId, name]);
      return name === "Outer" ? "real-outer" : "real-inner";
    });
    const p = props({ onCreateFolder });
    render(<SaveRequestDialog {...p} />);

    // First collection "My APIs" is selected by default → create "Outer" under it
    fireEvent.click(screen.getByRole("button", { name: /New folder in .*My APIs/ }));
    fireEvent.change(screen.getByLabelText("New node name"), { target: { value: "Outer" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    // Now "Outer" is selected → create "Inner" under it
    fireEvent.click(screen.getByRole("button", { name: /New folder in .*Outer/ }));
    fireEvent.change(screen.getByLabelText("New node name"), { target: { value: "Inner" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(p.onSave).toHaveBeenCalledWith({ collectionId: "c1", parentId: "real-inner", name: "Create" }),
    );
    // Outer created before Inner; Inner's parent is Outer's real id
    expect(calls).toEqual([
      ["c1", null, "Outer"],
      ["c1", "real-outer", "Inner"],
    ]);
  });
});
