import type * as React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
  }),
}));
vi.mock("@/ipc/client", () => ({
  envList: vi.fn().mockResolvedValue([]),
  envActiveSet: vi.fn().mockResolvedValue(undefined),
}));

import { Titlebar } from "./Titlebar";
import { workflowStore } from "@/features/workflow/store";

// Titlebar uses <Tooltip>, which (like the live app's main.tsx) requires a
// surrounding TooltipProvider. Wrap every render the same way the app does.
function render(ui: React.ReactElement) {
  return rtlRender(<TooltipProvider>{ui}</TooltipProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  workflowStore.reset();
});

describe("Titlebar", () => {
  it("renders workflow selector, env control and the English view switcher", async () => {
    render(<Titlebar onOpenSettings={() => {}} />);
    expect(screen.getByRole("button", { name: /workflow-1/ })).toBeInTheDocument();
    expect(await screen.findByText("No environment")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Ledger" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "List" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Focus" })).toBeInTheDocument();
  });

  it("renders the window control buttons", () => {
    render(<Titlebar onOpenSettings={() => {}} />);
    expect(screen.getByRole("button", { name: "Minimize window" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Maximize window" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close window" })).toBeInTheDocument();
  });

  it("makes the bar a Tauri drag region", () => {
    const { container } = render(<Titlebar onOpenSettings={() => {}} />);
    expect(container.querySelector("[data-tauri-drag-region]")).not.toBeNull();
  });

  it("calls onOpenSettings when the settings button is clicked", async () => {
    const onOpenSettings = vi.fn();
    const user = userEvent.setup();
    render(<Titlebar onOpenSettings={onOpenSettings} />);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});
