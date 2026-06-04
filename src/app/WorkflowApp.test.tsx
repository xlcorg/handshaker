import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Stub the heavy children so this test focuses on the shell's panel ↔ Focus logic.
vi.mock("@/features/catalog/Sidebar", () => ({
  Sidebar: ({ onOpenService }: { onOpenService: (s: { id: string }) => void }) => (
    <button type="button" onClick={() => onOpenService({ id: "svc1" })}>
      open-svc
    </button>
  ),
}));
vi.mock("@/features/catalog/ServicePanel", () => ({
  ServicePanel: ({ serviceId }: { serviceId: string }) => <div>PANEL:{serviceId}</div>,
}));
vi.mock("@/features/catalog/CommandPalette", () => ({
  CommandPalette: () => null,
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

// What every create-call entry point (sidebar, panel, ⌘K) does via openCallFromMethod.
function createCall() {
  act(() => {
    workflowStore.update((w) =>
      setView(addStep(w, newStep({ address: "h:443", tls: false, service: "p.S", method: "M" })), "focus"),
    );
  });
}

describe("WorkflowApp shell", () => {
  it("shows FocusView by default and the service panel after opening a service", async () => {
    const user = userEvent.setup();
    render(<WorkflowApp />);
    expect(screen.getByText("FOCUS")).toBeInTheDocument();

    await user.click(screen.getByText("open-svc"));
    expect(screen.getByText("PANEL:svc1")).toBeInTheDocument();
    expect(screen.queryByText("FOCUS")).not.toBeInTheDocument();
  });

  it("closes the open service panel and returns to Focus when a call is created", async () => {
    const user = userEvent.setup();
    render(<WorkflowApp />);
    await user.click(screen.getByText("open-svc"));
    expect(screen.getByText("PANEL:svc1")).toBeInTheDocument();

    createCall();

    expect(screen.getByText("FOCUS")).toBeInTheDocument();
    expect(screen.queryByText("PANEL:svc1")).not.toBeInTheDocument();
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
