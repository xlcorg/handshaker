import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CollectionIpc, ItemIpc } from "@/ipc/bindings";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("./CallPanel", () => ({
  CallPanel: ({
    step,
    origin,
    onQuickAddMethod,
    onSelectMethod,
  }: {
    step: { service: string; method: string };
    origin?: { collectionId: string; requestId: string } | null;
    onQuickAddMethod?: (service: string, method: string) => void;
    onSelectMethod: (method: {
      service: string;
      method: string;
      kind: "unary";
    }) => void;
  }) => (
    <div>
      <div>CALL:{step.method}</div>
      <div data-testid="origin-request-id">{origin?.requestId ?? ""}</div>
      <div data-testid="quickadd-wired">{onQuickAddMethod ? "yes" : "no"}</div>
      <button
        type="button"
        onClick={() =>
          onSelectMethod({
            service: step.service,
            method: "DeleteX",
            kind: "unary",
          })
        }
      >
        pick-DeleteX
      </button>
      <button
        type="button"
        onClick={() =>
          onSelectMethod({
            service: "other.v1.OtherService",
            method: "UpdateX",
            kind: "unary",
          })
        }
      >
        pick-UpdateX
      </button>
      <button
        type="button"
        onClick={() =>
          onSelectMethod({
            service: step.service,
            method: step.method,
            kind: "unary",
          })
        }
      >
        pick-same
      </button>
    </div>
  ),
}));

vi.mock("@/features/http/HttpPanel", () => ({
  HttpPanel: () => <div data-testid="http-panel" />,
}));

vi.mock("@/ipc/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/ipc/client")>();
  return {
    ...actual,
    grpcContractRead: vi.fn(async () => ({
      catalog: { services: [] },
      input_schema: null,
      output_schema: null,
      skeleton: "{}",
    })),
  };
});

const cat = vi.hoisted(() => ({
  tree: [] as CollectionIpc[],
  duplicateItem: vi.fn(),
  bumpUsage: vi.fn(() => Promise.resolve()),
  renameItem: vi.fn(() => Promise.resolve()),
  moveItem: vi.fn(() => Promise.resolve()),
  addItem: vi.fn<
    (collectionId: string, parentId: string | null, item: ItemIpc) => Promise<void>
  >(() => Promise.resolve()),
}));
vi.mock("@/features/catalog/CatalogProvider", () => ({
  useCatalog: () => ({
    tree: cat.tree,
    duplicateItem: cat.duplicateItem,
    bumpUsage: cat.bumpUsage,
    renameItem: cat.renameItem,
    moveItem: cat.moveItem,
    addItem: cat.addItem,
  }),
}));

const mockPatchUiState = vi.fn();
vi.mock("@/features/catalog/uiState", () => ({
  patchUiState: (...args: unknown[]) => mockPatchUiState(...args),
}));

import { FocusView } from "./FocusView";
import { workflowStore } from "./store";
import { newStep } from "./model";
import { newHttpStep } from "@/features/http/model";
import { messages } from "@/lib/messages";
import * as ipc from "@/ipc/client";

function renderFV(ui = <FocusView />) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

beforeEach(() => {
  workflowStore.reset();
  cat.tree = [];
  cat.duplicateItem.mockReset();
  mockPatchUiState.mockReset();
  cat.bumpUsage.mockClear();
  cat.renameItem.mockClear();
  cat.moveItem.mockClear();
  cat.addItem.mockClear();
  vi.mocked(ipc.grpcContractRead).mockClear();
});

describe("FocusView Save affordance", () => {
  it("shows the empty state and no Save button when there is no draft", () => {
    renderFV();
    expect(
      screen.getByText(messages.workflow.focus.noActiveRequest),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: messages.workflow.focus.save }),
    ).not.toBeInTheDocument();
  });

  it("shows a Save button for an unbound draft and calls onRequestSave", async () => {
    const user = userEvent.setup();
    const onRequestSave = vi.fn();
    workflowStore.setDraft(
      newStep({ address: "h:443", tls: false, service: "p.S", method: "GetX" }),
    );
    renderFV(<FocusView onRequestSave={onRequestSave} />);
    expect(screen.getByText("CALL:GetX")).toBeInTheDocument();
    expect(screen.queryByTestId("draft-dirty-dot")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: messages.workflow.focus.save }),
    );
    expect(onRequestSave).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("autosave-status")).not.toBeInTheDocument();
  });

  it("shows the autosave status (no Save button) for an origin-bound draft", () => {
    workflowStore.setDraft(
      newStep({ address: "h:443", tls: false, service: "p.S", method: "GetX" }),
      { collectionId: "c1", requestId: "r1" },
    );
    renderFV(<FocusView onRequestSave={vi.fn()} />);
    expect(screen.getByTestId("autosave-status")).toHaveAccessibleName(
      messages.workflow.focus.saved,
    );
    expect(
      screen.queryByRole("button", { name: messages.workflow.focus.save }),
    ).not.toBeInTheDocument();
  });

  it("shows the unbound breadcrumb label for a draft with no origin", () => {
    workflowStore.setDraft(
      newStep({ address: "h:443", tls: false, service: "p.S", method: "GetX" }),
    );
    renderFV(<FocusView onRequestSave={vi.fn()} />);
    expect(screen.getByTestId("draft-breadcrumb")).toHaveTextContent(
      messages.workflow.draft.newRequest,
    );
  });

  it("shows a dirty dot once the unbound draft is edited", () => {
    workflowStore.setDraft(
      newStep({ address: "h:443", tls: false, service: "p.S", method: "GetX" }),
    );
    workflowStore.updateGrpcDraft(workflowStore.getState().draft!.id, {
      requestJson: '{"a":1}',
    });
    renderFV(<FocusView onRequestSave={vi.fn()} />);
    expect(screen.getByTestId("draft-dirty-dot")).toBeInTheDocument();
  });

  it("shows the collection breadcrumb for a bound draft", () => {
    workflowStore.setDraft(
      newStep({ address: "h:443", tls: false, service: "p.S", method: "GetX" }),
      {
        collectionId: "c1",
        requestId: "r1",
        collectionName: "Notes",
        requestName: "Create",
      },
    );
    renderFV(<FocusView onRequestSave={vi.fn()} />);
    const crumb = screen.getByTestId("draft-breadcrumb");
    expect(crumb).toHaveTextContent("Notes › Create");
    // The separator before the last segment must be a non-breaking space — a
    // normal trailing space inside the `truncate` (white-space: nowrap) span is
    // stripped by the browser, gluing the chevron to the request name.
    expect(crumb.textContent).toContain("› Create");
  });

  it("shows the full live path from the catalog for a bound draft", () => {
    cat.tree = [
      {
        id: "c1",
        name: "Notes",
        default_tls: false,
        skip_tls_verify: false,
        pinned: false,
        description: null,
        created_at: 0,
        variables: {},
        auth: { kind: "none" },
        expanded: false,
        items: [
          {
            type: "folder",
            id: "f1",
            name: "Staging",
            expanded: false,
            items: [
              {
                type: "request",
                id: "r1",
                name: "Create",
                template: {
                  protocol: "grpc",
                  address_template: "h:443",
                  service: "p.v1.S",
                  method: "M",
                  body_template: "{}",
                  metadata: [],
                  auth: { kind: "none" },
                  tls_override: null,
                },
                last_used_at: null,
                use_count: 0,
              },
            ],
          },
        ],
      },
    ];
    workflowStore.setDraft(
      newStep({ address: "h:443", tls: false, service: "p.S", method: "GetX" }),
      {
        collectionId: "c1",
        requestId: "r1",
        collectionName: "Notes",
        requestName: "Create",
      },
    );
    renderFV(<FocusView onRequestSave={vi.fn()} />);
    expect(screen.getByTestId("draft-breadcrumb")).toHaveTextContent(
      "Notes › Staging › Create",
    );
  });

  it("passes the origin to CallPanel for a bound draft (the call lifecycle credits the saved request)", () => {
    workflowStore.setDraft(
      newStep({ address: "h:443", tls: false, service: "p.S", method: "GetX" }),
      { collectionId: "c1", requestId: "r1" },
    );
    renderFV();
    expect(screen.getByTestId("origin-request-id")).toHaveTextContent("r1");
  });

  it("passes no origin for an unbound draft", () => {
    workflowStore.setDraft(
      newStep({ address: "h:443", tls: false, service: "p.S", method: "GetX" }),
    );
    renderFV();
    expect(screen.getByTestId("origin-request-id")).toHaveTextContent(/^$/);
  });

  it("duplicates the bound request and opens the copy", async () => {
    const copied: ItemIpc = {
      type: "request",
      id: "r1-copy",
      name: "Get copy",
      template: {
        protocol: "grpc",
        address_template: "h:1",
        service: "p.S",
        method: "Get",
        body_template: "{}",
        metadata: [],
        auth: { kind: "none" },
        tls_override: false,
      },
      last_used_at: null,
      use_count: 0,
    };
    cat.duplicateItem.mockResolvedValue(copied);
    mockPatchUiState.mockResolvedValue(undefined);
    workflowStore.setDraft(
      newStep({ address: "h:1", tls: false, service: "p.S", method: "Get" }),
      { collectionId: "c1", requestId: "r1", requestName: "Get" },
    );
    const user = userEvent.setup();
    renderFV();
    await user.click(
      screen.getByRole("button", {
        name: messages.workflow.focus.duplicateRequest,
      }),
    );
    expect(cat.duplicateItem).toHaveBeenCalledWith("c1", "r1");
    await waitFor(() => {
      const st = workflowStore.getState();
      expect(st.draftOrigin?.requestId).toBe("r1-copy");
      expect(st.draft).toMatchObject({ protocol: "grpc", method: "Get" });
    });
    expect(mockPatchUiState).toHaveBeenCalledWith(
      expect.objectContaining({
        active_request: { collection_id: "c1", item_id: "r1-copy" },
      }),
    );
  });

  it("shows no duplicate button for an unbound draft", () => {
    workflowStore.setDraft(
      newStep({ address: "h:1", tls: false, service: "p.S", method: "Get" }),
    );
    renderFV();
    expect(
      screen.queryByRole("button", {
        name: messages.workflow.focus.duplicateRequest,
      }),
    ).toBeNull();
  });

  it("wires quick-add to CallPanel only for a bound draft (has a target collection)", () => {
    workflowStore.setDraft(
      newStep({ address: "h:1", tls: false, service: "p.S", method: "Get" }),
      { collectionId: "c1", requestId: "r1" },
    );
    renderFV(<FocusView onQuickAddMethod={vi.fn()} />);
    expect(screen.getByTestId("quickadd-wired")).toHaveTextContent("yes");
  });

  it("does NOT wire quick-add for an unbound draft (no collection to save into)", () => {
    workflowStore.setDraft(
      newStep({ address: "h:1", tls: false, service: "p.S", method: "Get" }),
    );
    renderFV(<FocusView onQuickAddMethod={vi.fn()} />);
    expect(screen.getByTestId("quickadd-wired")).toHaveTextContent("no");
  });
});

function collectionWith(items: ItemIpc[]): CollectionIpc[] {
  return [
    {
      id: "c1",
      name: "Notes",
      default_tls: false,
      skip_tls_verify: false,
      pinned: false,
      description: null,
      created_at: 0,
      variables: {},
      auth: { kind: "none" },
      expanded: true,
      items,
    },
  ];
}

function savedRequest(name: string, id = "r1"): ItemIpc {
  return {
    type: "request",
    id,
    name,
    template: {
      protocol: "grpc",
      address_template: "h:443",
      service: "p.S",
      method: "GetX",
      body_template: "{}",
      metadata: [],
      auth: { kind: "none" },
      tls_override: null,
    },
    last_used_at: null,
    use_count: 0,
  };
}

function bindSaved(name: string, items?: ItemIpc[]) {
  cat.tree = collectionWith(items ?? [savedRequest(name)]);
  workflowStore.setDraft(
    newStep({ address: "h:443", tls: null, service: "p.S", method: "GetX" }),
    { collectionId: "c1", requestId: "r1" },
  );
}

async function pickDifferent(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "pick-DeleteX" }));
}

describe("FocusView auto-rename on method change", () => {
  it("renames an origin-bound request to the new method when its name still tracks the old method", async () => {
    const user = userEvent.setup();
    bindSaved("GetX");
    renderFV();
    await pickDifferent(user);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(cat.renameItem).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", {
        name: messages.workflow.methodChange.change,
      }),
    );
    await waitFor(() =>
      expect(screen.getByText("CALL:DeleteX")).toBeInTheDocument(),
    );
    expect(cat.renameItem).toHaveBeenCalledTimes(1);
    expect(cat.renameItem).toHaveBeenCalledWith("c1", "r1", "DeleteX");
    expect(cat.moveItem).not.toHaveBeenCalled();
  });

  it("leaves a customized name untouched on method change", async () => {
    const user = userEvent.setup();
    bindSaved("My favorite call");
    renderFV();
    await pickDifferent(user);
    expect(cat.renameItem).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", {
        name: messages.workflow.methodChange.change,
      }),
    );
    await waitFor(() =>
      expect(screen.getByText("CALL:DeleteX")).toBeInTheDocument(),
    );
    expect(cat.renameItem).not.toHaveBeenCalled();
  });

  it("does not rename for an unbound draft (no saved request to rename)", async () => {
    const user = userEvent.setup();
    workflowStore.setDraft(
      newStep({ address: "h:443", tls: false, service: "p.S", method: "GetX" }),
    );
    renderFV();
    await pickDifferent(user);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText("CALL:DeleteX")).toBeInTheDocument(),
    );
    expect(cat.renameItem).not.toHaveBeenCalled();
  });

  it("never moves the request between folders on method change", async () => {
    const user = userEvent.setup();
    bindSaved("GetX");
    renderFV();
    await pickDifferent(user);
    await user.click(
      screen.getByRole("button", {
        name: messages.workflow.methodChange.change,
      }),
    );
    await waitFor(() =>
      expect(screen.getByText("CALL:DeleteX")).toBeInTheDocument(),
    );
    expect(cat.moveItem).not.toHaveBeenCalled();
  });
});

describe("FocusView saved method confirmation", () => {
  const copy = messages.workflow.methodChange;

  it("asks before a different method replaces a saved request", async () => {
    const user = userEvent.setup();
    bindSaved("GetX");
    renderFV();
    await pickDifferent(user);
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent(copy.title);
    expect(dialog).toHaveTextContent(copy.body("S", "GetX", "S", "DeleteX"));
    expect(screen.getByRole("button", { name: copy.cancel })).toHaveFocus();
    expect(screen.getByText("CALL:GetX")).toBeInTheDocument();
    expect(cat.renameItem).not.toHaveBeenCalled();
    expect(cat.addItem).not.toHaveBeenCalled();
    expect(ipc.grpcContractRead).not.toHaveBeenCalled();
  });

  it("Cancel leaves the saved method", async () => {
    const user = userEvent.setup();
    bindSaved("GetX");
    renderFV();
    await pickDifferent(user);
    await user.click(screen.getByRole("button", { name: copy.cancel }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByText("CALL:GetX")).toBeInTheDocument();
    expect(cat.renameItem).not.toHaveBeenCalled();
    expect(cat.addItem).not.toHaveBeenCalled();
  });

  it("Escape leaves the saved method", async () => {
    const user = userEvent.setup();
    bindSaved("GetX");
    renderFV();
    await pickDifferent(user);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByText("CALL:GetX")).toBeInTheDocument();
    expect(cat.renameItem).not.toHaveBeenCalled();
    expect(cat.addItem).not.toHaveBeenCalled();
  });

  it("Change current updates an auto-named request after the contract read", async () => {
    const user = userEvent.setup();
    bindSaved("GetX");
    renderFV();
    await pickDifferent(user);
    await user.click(screen.getByRole("button", { name: copy.change }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText("CALL:DeleteX")).toBeInTheDocument(),
    );
    expect(cat.renameItem).toHaveBeenCalledTimes(1);
    expect(cat.renameItem).toHaveBeenCalledWith("c1", "r1", "DeleteX");
    expect(ipc.grpcContractRead).toHaveBeenCalled();
  });

  it("Change current keeps a custom name", async () => {
    const user = userEvent.setup();
    bindSaved("My favorite call");
    renderFV();
    await pickDifferent(user);
    await user.click(screen.getByRole("button", { name: copy.change }));
    await waitFor(() =>
      expect(screen.getByText("CALL:DeleteX")).toBeInTheDocument(),
    );
    expect(cat.renameItem).not.toHaveBeenCalled();
  });

  it("Create adds a sibling and opens it", async () => {
    const user = userEvent.setup();
    const auth = {
      kind: "env_var" as const,
      env_var: "TOK",
      header_name: "authorization",
      prefix: "Bearer ",
    };
    const metadata = [{ key: "x-req", value: "1", enabled: false }];
    cat.tree = collectionWith([
      {
        type: "folder",
        id: "f-outer",
        name: "Outer",
        expanded: true,
        items: [
          {
            type: "folder",
            id: "f-inner",
            name: "Inner",
            expanded: true,
            items: [savedRequest("GetX")],
          },
        ],
      },
    ]);
    workflowStore.setDraft(
      newStep({
        address: "api.internal:443",
        tls: null,
        service: "pkg.v1.NotesService",
        method: "GetX",
        requestJson: '{"id":"kept"}',
        metadata,
        auth,
      }),
      { collectionId: "c1", requestId: "r1" },
    );
    renderFV();
    await pickDifferent(user);
    await user.click(screen.getByRole("button", { name: copy.create }));
    await waitFor(() => expect(cat.addItem).toHaveBeenCalledTimes(1));
    const [collectionId, parentId, item] = cat.addItem.mock.calls[0];
    expect(collectionId).toBe("c1");
    expect(parentId).toBe("f-inner");
    expect(item).toMatchObject({
      type: "request",
      name: "DeleteX",
      last_used_at: null,
      use_count: 0,
      template: {
        protocol: "grpc",
        address_template: "api.internal:443",
        tls_override: null,
        service: "pkg.v1.NotesService",
        method: "DeleteX",
        body_template: '{"id":"kept"}',
        metadata,
        auth,
      },
    });
    expect(item.id).not.toBe("r1");
    await waitFor(() =>
      expect(workflowStore.getState().draftOrigin?.requestId).toBe(item.id),
    );
    expect(screen.getByText("CALL:DeleteX")).toBeInTheDocument();
    expect(cat.renameItem).not.toHaveBeenCalled();
  });

  it("Create at the collection root uses a null parent", async () => {
    const user = userEvent.setup();
    bindSaved("GetX");
    renderFV();
    await pickDifferent(user);
    await user.click(screen.getByRole("button", { name: copy.create }));
    await waitFor(() => expect(cat.addItem).toHaveBeenCalledTimes(1));
    expect(cat.addItem).toHaveBeenCalledWith(
      "c1",
      null,
      expect.objectContaining({ type: "request", name: "DeleteX" }),
    );
  });

  it("Create writes nothing when the source request is not in the tree", async () => {
    const user = userEvent.setup();
    cat.tree = collectionWith([]);
    workflowStore.setDraft(
      newStep({ address: "h:443", tls: null, service: "p.S", method: "GetX" }),
      { collectionId: "c1", requestId: "r1" },
    );
    renderFV();
    await pickDifferent(user);
    await user.click(screen.getByRole("button", { name: copy.create }));
    expect(cat.addItem).not.toHaveBeenCalled();
    expect(screen.getByText("CALL:GetX")).toBeInTheDocument();
    expect(workflowStore.getState().draftOrigin?.requestId).toBe("r1");
  });

  it("applies a different method on an unbound draft without asking", async () => {
    const user = userEvent.setup();
    workflowStore.setDraft(
      newStep({ address: "h:443", tls: false, service: "p.S", method: "GetX" }),
    );
    renderFV();
    await pickDifferent(user);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText("CALL:DeleteX")).toBeInTheDocument(),
    );
    expect(cat.renameItem).not.toHaveBeenCalled();
    expect(cat.addItem).not.toHaveBeenCalled();
  });

  it("applies the same method on a saved request without asking", async () => {
    const user = userEvent.setup();
    bindSaved("GetX");
    renderFV();
    await user.click(screen.getByRole("button", { name: "pick-same" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByText("CALL:GetX")).toBeInTheDocument();
    await waitFor(() =>
      expect(ipc.grpcContractRead).toHaveBeenCalledWith(
        "h:443",
        null,
        { collection_id: "c1", env_name: null },
        { service: "p.S", method: "GetX", refresh: false },
      ),
    );
  });

  it("keeps the first method when another method is clicked while the dialog is open", async () => {
    const user = userEvent.setup();
    bindSaved("GetX");
    renderFV();
    await pickDifferent(user);
    fireEvent.click(screen.getByRole("button", { name: "pick-UpdateX", hidden: true }));
    const dialogs = screen.getAllByRole("alertdialog");
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]).toHaveTextContent(
      copy.body("S", "GetX", "S", "DeleteX"),
    );
    expect(dialogs[0]).not.toHaveTextContent("UpdateX");
    expect(screen.getByText("CALL:GetX")).toBeInTheDocument();
    expect(cat.renameItem).not.toHaveBeenCalled();
    expect(cat.addItem).not.toHaveBeenCalled();
  });

  it("does not ask for an HTTP draft", () => {
    workflowStore.setDraft(newHttpStep());
    renderFV();
    expect(screen.getByTestId("http-panel")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "pick-DeleteX" }),
    ).not.toBeInTheDocument();
  });
});
