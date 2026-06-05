import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Stub the heavy children so this test focuses on the shell's panel ↔ Focus logic.
vi.mock("@/features/catalog/SidebarShell", () => ({
  SidebarShell: ({ onOpenCollection }: { onOpenCollection: (id: string) => void }) => (
    <button type="button" onClick={() => onOpenCollection("c1")}>
      open-col
    </button>
  ),
}));
vi.mock("@/features/catalog/overview/CollectionOverview", () => ({
  CollectionOverview: ({ collection }: { collection: { id: string } }) => (
    <div>OVERVIEW:{collection.id}</div>
  ),
}));
vi.mock("@/features/catalog/CommandPalette", () => ({
  CommandPalette: () => null,
}));
vi.mock("@/features/catalog/actions", () => ({
  openSavedRequest: vi.fn(),
}));
// One controlled catalog tree so opening collection "c1" finds a collection object.
vi.mock("@/features/catalog/useCatalogTree", () => ({
  useCatalogTree: () => ({
    tree: [{ id: "c1", name: "C1", items: [], variables: {}, auth: { kind: "none" } }],
    loading: false,
    error: null,
    reload: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock("@/features/workflow/FocusView", () => ({
  FocusView: () => <div>FOCUS</div>,
}));
// Stub IPC so WorkflowEnvControl's envList() on mount doesn't hit a real backend.
vi.mock("@/ipc/client", () => ({
  envList: vi.fn().mockResolvedValue([]),
  envActiveSet: vi.fn().mockResolvedValue(undefined),
}));

import { WorkflowApp } from "./WorkflowApp";
import { workflowStore } from "@/features/workflow/store";
import { addStep, setView } from "@/features/workflow/reducers";
import { newStep } from "@/features/workflow/model";

beforeEach(() => {
  workflowStore.reset();
});

// What every create-call entry point (sidebar, overview, ⌘K) ultimately does to the store.
function createCall() {
  act(() => {
    workflowStore.update((w) =>
      setView(addStep(w, newStep({ address: "h:443", tls: false, service: "p.S", method: "M" })), "focus"),
    );
  });
}

describe("WorkflowApp shell", () => {
  it("shows FocusView by default and the collection overview after opening a collection", async () => {
    const user = userEvent.setup();
    render(<WorkflowApp />);
    expect(screen.getByText("FOCUS")).toBeInTheDocument();

    await user.click(screen.getByText("open-col"));
    expect(screen.getByText("OVERVIEW:c1")).toBeInTheDocument();
    expect(screen.queryByText("FOCUS")).not.toBeInTheDocument();
  });

  it("closes the open collection overview and returns to Focus when a call is created", async () => {
    const user = userEvent.setup();
    render(<WorkflowApp />);
    await user.click(screen.getByText("open-col"));
    expect(screen.getByText("OVERVIEW:c1")).toBeInTheDocument();

    createCall();

    expect(screen.getByText("FOCUS")).toBeInTheDocument();
    expect(screen.queryByText("OVERVIEW:c1")).not.toBeInTheDocument();
  });
});

describe("WorkflowApp titlebar + view dispatch", () => {
  it("renders the workflow selector, env control and view switcher", async () => {
    render(<WorkflowApp />);
    expect(screen.getByRole("button", { name: /workflow-1/ })).toBeInTheDocument();
    expect(await screen.findByText(/No environment/i)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Лента" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Список" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Фокус" })).toBeInTheDocument();
  });

  it("renders the workflow env control instead of the static chip", async () => {
    render(<WorkflowApp />);
    expect(screen.queryByText("env: default")).not.toBeInTheDocument();
    expect(await screen.findByText(/No environment/i)).toBeInTheDocument();
  });

  it("defaults to Focus (the mocked FocusView) and switches to the real List view", async () => {
    const user = userEvent.setup();
    render(<WorkflowApp />);
    expect(screen.getByText("FOCUS")).toBeInTheDocument(); // mocked FocusView
    await user.click(screen.getByRole("radio", { name: "Список" }));
    expect(screen.queryByText("FOCUS")).not.toBeInTheDocument();
    expect(screen.getByText(/Нет шагов/)).toBeInTheDocument(); // real ListView empty state
  });
});
