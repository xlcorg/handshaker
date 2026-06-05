import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("./CallPanel", () => ({
  CallPanel: ({ step }: { step: { method: string } }) => <div>CALL:{step.method}</div>,
}));

import { FocusView } from "./FocusView";
import { workflowStore } from "./store";
import { newStep } from "./model";

beforeEach(() => {
  workflowStore.reset();
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

  it("shows the breadcrumb 'New request' for an unbound draft", () => {
    workflowStore.setDraft(newStep({ address: "h:443", tls: false, service: "p.S", method: "GetX" }));
    render(<FocusView onRequestSave={vi.fn()} />);
    expect(screen.getByTestId("draft-breadcrumb")).toHaveTextContent("New request");
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
    expect(screen.getByTestId("draft-breadcrumb")).toHaveTextContent("Notes › Create");
  });
});
