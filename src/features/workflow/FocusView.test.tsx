import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CollectionIpc } from "@/ipc/bindings";

vi.mock("./CallPanel", () => ({
  CallPanel: ({ step }: { step: { method: string } }) => <div>CALL:{step.method}</div>,
}));

const cat = vi.hoisted(() => ({ tree: [] as CollectionIpc[] }));
vi.mock("@/features/catalog/CatalogProvider", () => ({
  useCatalog: () => ({ tree: cat.tree }),
}));

import { FocusView } from "./FocusView";
import { workflowStore } from "./store";
import { newStep } from "./model";

beforeEach(() => {
  workflowStore.reset();
  cat.tree = [];
});

describe("FocusView Save affordance", () => {
  it("shows the empty state and no Save button when there is no draft", () => {
    render(<FocusView />);
    expect(screen.getByText(/Нет активного реквеста/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Сохранить" })).not.toBeInTheDocument();
  });

  it("shows a Save button for an unbound draft and calls onRequestSave", async () => {
    const user = userEvent.setup();
    const onRequestSave = vi.fn();
    workflowStore.setDraft(newStep({ address: "h:443", tls: false, service: "p.S", method: "GetX" }));
    render(<FocusView onRequestSave={onRequestSave} />);
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
    render(<FocusView onRequestSave={vi.fn()} />);
    expect(screen.getByTestId("autosave-status")).toHaveTextContent("Сохранено");
    expect(screen.queryByRole("button", { name: "Сохранить" })).not.toBeInTheDocument();
  });

  it("shows the unbound breadcrumb label for a draft with no origin", () => {
    workflowStore.setDraft(newStep({ address: "h:443", tls: false, service: "p.S", method: "GetX" }));
    render(<FocusView onRequestSave={vi.fn()} />);
    expect(screen.getByTestId("draft-breadcrumb")).toHaveTextContent("Новый реквест");
  });

  it("shows a dirty dot once the unbound draft is edited", () => {
    workflowStore.setDraft(newStep({ address: "h:443", tls: false, service: "p.S", method: "GetX" }));
    workflowStore.updateDraft({ requestJson: '{"a":1}' });
    render(<FocusView onRequestSave={vi.fn()} />);
    expect(screen.getByTestId("draft-dirty-dot")).toBeInTheDocument();
  });

  it("shows the collection breadcrumb for a bound draft", () => {
    workflowStore.setDraft(
      newStep({ address: "h:443", tls: false, service: "p.S", method: "GetX" }),
      { collectionId: "c1", requestId: "r1", collectionName: "Notes", requestName: "Create" },
    );
    render(<FocusView onRequestSave={vi.fn()} />);
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
    render(<FocusView onRequestSave={vi.fn()} />);
    expect(screen.getByTestId("draft-breadcrumb")).toHaveTextContent("Notes › Staging › Create");
  });
});
