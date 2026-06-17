import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CollectionIpc, ItemIpc } from "@/ipc/bindings";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("./CallPanel", () => ({
  CallPanel: ({
    step,
    originAuth,
    onQuickAddMethod,
    onExecuted,
  }: {
    step: { method: string };
    originAuth?: { kind: string };
    onQuickAddMethod?: (service: string, method: string) => void;
    onExecuted?: (executed: unknown) => void;
  }) => (
    <div>
      <div>CALL:{step.method}</div>
      <div data-testid="origin-auth">{originAuth?.kind ?? ""}</div>
      <div data-testid="quickadd-wired">{onQuickAddMethod ? "yes" : "no"}</div>
      {/* Simulate CallPanel firing onExecuted (gated on shouldRecordExecuted = server responded). */}
      <button type="button" onClick={() => onExecuted?.(step)}>
        fire-executed
      </button>
    </div>
  ),
}));

const cat = vi.hoisted(() => ({
  tree: [] as CollectionIpc[],
  duplicateItem: vi.fn(),
  bumpUsage: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/features/catalog/CatalogProvider", () => ({
  useCatalog: () => ({ tree: cat.tree, duplicateItem: cat.duplicateItem, bumpUsage: cat.bumpUsage }),
}));

const mockPatchUiState = vi.fn();
vi.mock("@/features/catalog/uiState", () => ({
  patchUiState: (...args: unknown[]) => mockPatchUiState(...args),
}));

import { FocusView } from "./FocusView";
import { workflowStore } from "./store";
import { newStep } from "./model";

function renderFV(ui = <FocusView />) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

beforeEach(() => {
  workflowStore.reset();
  cat.tree = [];
  cat.duplicateItem.mockReset();
  mockPatchUiState.mockReset();
  cat.bumpUsage.mockClear();
});

describe("FocusView Save affordance", () => {
  it("shows the empty state and no Save button when there is no draft", () => {
    renderFV();
    expect(screen.getByText(/Нет активного реквеста/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Сохранить" })).not.toBeInTheDocument();
  });

  it("shows a Save button for an unbound draft and calls onRequestSave", async () => {
    const user = userEvent.setup();
    const onRequestSave = vi.fn();
    workflowStore.setDraft(newStep({ address: "h:443", tls: false, service: "p.S", method: "GetX" }));
    renderFV(<FocusView onRequestSave={onRequestSave} />);
    expect(screen.getByText("CALL:GetX")).toBeInTheDocument();
    expect(screen.queryByTestId("draft-dirty-dot")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(onRequestSave).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("autosave-status")).not.toBeInTheDocument();
  });

  it("shows the autosave status (no Save button) for an origin-bound draft", () => {
    workflowStore.setDraft(
      newStep({ address: "h:443", tls: false, service: "p.S", method: "GetX" }),
      { collectionId: "c1", requestId: "r1" },
    );
    renderFV(<FocusView onRequestSave={vi.fn()} />);
    expect(screen.getByTestId("autosave-status")).toHaveAccessibleName("Сохранено");
    expect(screen.queryByRole("button", { name: "Сохранить" })).not.toBeInTheDocument();
  });

  it("shows the unbound breadcrumb label for a draft with no origin", () => {
    workflowStore.setDraft(newStep({ address: "h:443", tls: false, service: "p.S", method: "GetX" }));
    renderFV(<FocusView onRequestSave={vi.fn()} />);
    expect(screen.getByTestId("draft-breadcrumb")).toHaveTextContent("Новый реквест");
  });

  it("shows a dirty dot once the unbound draft is edited", () => {
    workflowStore.setDraft(newStep({ address: "h:443", tls: false, service: "p.S", method: "GetX" }));
    workflowStore.updateDraft({ requestJson: '{"a":1}' });
    renderFV(<FocusView onRequestSave={vi.fn()} />);
    expect(screen.getByTestId("draft-dirty-dot")).toBeInTheDocument();
  });

  it("shows the collection breadcrumb for a bound draft", () => {
    workflowStore.setDraft(
      newStep({ address: "h:443", tls: false, service: "p.S", method: "GetX" }),
      { collectionId: "c1", requestId: "r1", collectionName: "Notes", requestName: "Create" },
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
        id: "c1", name: "Notes", default_tls: false, skip_tls_verify: false,
        pinned: false, description: null, created_at: 0, variables: {}, auth: { kind: "none" },
        expanded: false,
        items: [
          {
            type: "folder", id: "f1", name: "Staging", expanded: false,
            items: [
              {
                type: "request", id: "r1", name: "Create", address_template: "h:443",
                service: "p.v1.S", method: "M", body_template: "{}", metadata: [],
                auth: { kind: "none" }, tls_override: null, last_used_at: null, use_count: 0,
              },
            ],
          },
        ],
      },
    ];
    workflowStore.setDraft(
      newStep({ address: "h:443", tls: false, service: "p.S", method: "GetX" }),
      { collectionId: "c1", requestId: "r1", collectionName: "Notes", requestName: "Create" },
    );
    renderFV(<FocusView onRequestSave={vi.fn()} />);
    expect(screen.getByTestId("draft-breadcrumb")).toHaveTextContent("Notes › Staging › Create");
  });

  it("passes the origin collection's auth to CallPanel for a bound draft", () => {
    cat.tree = [
      {
        id: "c1", name: "Notes", default_tls: false, skip_tls_verify: false,
        pinned: false, description: null, created_at: 0, variables: {},
        auth: {
          kind: "oauth2_client_credentials", token_url: "https://idp/token", client_id: "c",
          client_secret: "{{s}}", scopes: [], header_name: "authorization", prefix: "Bearer ",
          environments: [],
        },
        expanded: false,
        items: [],
      },
    ];
    workflowStore.setDraft(
      newStep({ address: "h:443", tls: false, service: "p.S", method: "GetX" }),
      { collectionId: "c1", requestId: "r1" },
    );
    renderFV();
    expect(screen.getByTestId("origin-auth")).toHaveTextContent("oauth2_client_credentials");
  });

  it("passes no originAuth for an unbound draft", () => {
    workflowStore.setDraft(newStep({ address: "h:443", tls: false, service: "p.S", method: "GetX" }));
    renderFV();
    expect(screen.getByTestId("origin-auth")).toHaveTextContent(/^$/);
  });

  it("duplicates the bound request and opens the copy", async () => {
    const copied: ItemIpc = {
      type: "request", id: "r1-copy", name: "Get copy", address_template: "h:1",
      service: "p.S", method: "Get", body_template: "{}", metadata: [],
      auth: { kind: "none" }, tls_override: false, last_used_at: null, use_count: 0,
    };
    cat.duplicateItem.mockResolvedValue(copied);
    mockPatchUiState.mockResolvedValue(undefined);
    workflowStore.setDraft(
      newStep({ address: "h:1", tls: false, service: "p.S", method: "Get" }),
      { collectionId: "c1", requestId: "r1", requestName: "Get" },
    );
    const user = userEvent.setup();
    renderFV();
    await user.click(screen.getByRole("button", { name: "Duplicate request" }));
    expect(cat.duplicateItem).toHaveBeenCalledWith("c1", "r1");
    await waitFor(() => {
      const st = workflowStore.getState();
      expect(st.draftOrigin?.requestId).toBe("r1-copy");
      expect(st.draft?.method).toBe("Get");
    });
    expect(mockPatchUiState).toHaveBeenCalledWith(
      expect.objectContaining({ active_request: { collection_id: "c1", item_id: "r1-copy" } }),
    );
  });

  it("shows no duplicate button for an unbound draft", () => {
    workflowStore.setDraft(newStep({ address: "h:1", tls: false, service: "p.S", method: "Get" }));
    renderFV();
    expect(screen.queryByRole("button", { name: "Duplicate request" })).toBeNull();
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
    workflowStore.setDraft(newStep({ address: "h:1", tls: false, service: "p.S", method: "Get" }));
    renderFV(<FocusView onQuickAddMethod={vi.fn()} />);
    expect(screen.getByTestId("quickadd-wired")).toHaveTextContent("no");
  });

  it("bumps usage on the origin request when a send reaches the server (bound draft)", async () => {
    const user = userEvent.setup();
    workflowStore.setDraft(
      newStep({ address: "h:443", tls: false, service: "p.S", method: "GetX" }),
      { collectionId: "c1", requestId: "r1" },
    );
    renderFV();
    await user.click(screen.getByRole("button", { name: "fire-executed" }));
    expect(cat.bumpUsage).toHaveBeenCalledWith("c1", "r1", expect.any(Number));
  });

  it("does not bump usage for an unbound draft (no origin request to credit)", async () => {
    const user = userEvent.setup();
    workflowStore.setDraft(newStep({ address: "h:443", tls: false, service: "p.S", method: "GetX" }));
    renderFV();
    await user.click(screen.getByRole("button", { name: "fire-executed" }));
    expect(cat.bumpUsage).not.toHaveBeenCalled();
  });
});
