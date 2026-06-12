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
    isFullscreen: vi.fn().mockResolvedValue(false),
    onResized: vi.fn().mockResolvedValue(() => {}),
  }),
}));
vi.mock("@/ipc/client", () => ({
  envList: vi.fn().mockResolvedValue([]),
  envActiveSet: vi.fn().mockResolvedValue(undefined),
}));

// isMacOS is a const evaluated at import; expose it through a getter so each
// describe block can flip the platform before rendering.
let mockIsMacOS = false;
vi.mock("@/lib/platform", () => ({
  get isMacOS() {
    return mockIsMacOS;
  },
}));

let mockFullscreen = false;
vi.mock("@/lib/use-fullscreen", () => ({
  useIsFullscreen: () => mockFullscreen,
}));

import { Titlebar } from "./Titlebar";
import { workflowStore } from "@/features/workflow/store";

// Titlebar uses <Tooltip>, which (like main.tsx) requires a TooltipProvider.
function render(ui: React.ReactElement) {
  return rtlRender(<TooltipProvider>{ui}</TooltipProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  workflowStore.reset();
  mockFullscreen = false;
});

describe("Titlebar (both platforms)", () => {
  beforeEach(() => {
    mockIsMacOS = false;
  });

  it("renders workflow selector, env control and the English view switcher", async () => {
    render(<Titlebar onOpenSettings={() => {}} />);
    expect(screen.getByRole("button", { name: /workflow-1/ })).toBeInTheDocument();
    expect(await screen.findByText("No environment")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Ledger" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "List" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Focus" })).toBeInTheDocument();
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

  it("renders a check-for-updates button that calls onCheckForUpdates", async () => {
    const onCheckForUpdates = vi.fn();
    const user = userEvent.setup();
    render(<Titlebar onOpenSettings={() => {}} onCheckForUpdates={onCheckForUpdates} updatePhase="idle" />);
    await user.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(onCheckForUpdates).toHaveBeenCalledTimes(1);
  });

  it("omits the check button without a handler and disables it while checking", () => {
    const { rerender } = render(<Titlebar onOpenSettings={() => {}} />);
    expect(screen.queryByRole("button", { name: "Check for updates" })).toBeNull();
    rerender(<TooltipProvider><Titlebar onOpenSettings={() => {}} onCheckForUpdates={() => {}} updatePhase="checking" /></TooltipProvider>);
    expect(screen.getByRole("button", { name: "Check for updates" })).toBeDisabled();
  });

  it("shows the update-available badge when an update is pending (even when idle)", () => {
    render(<Titlebar onOpenSettings={() => {}} onCheckForUpdates={() => {}} updatePhase="idle" updateAvailable />);
    expect(screen.getByTestId("update-available-dot")).toBeInTheDocument();
  });
});

describe("Titlebar on Windows/Linux", () => {
  beforeEach(() => {
    mockIsMacOS = false;
  });

  it("renders the custom window control buttons", () => {
    render(<Titlebar onOpenSettings={() => {}} />);
    expect(screen.getByRole("button", { name: "Minimize window" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Maximize window" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close window" })).toBeInTheDocument();
  });

  it("shows the Handshaker wordmark", () => {
    render(<Titlebar onOpenSettings={() => {}} />);
    expect(screen.getByText("Handshaker")).toBeInTheDocument();
  });
});

describe("Titlebar on macOS", () => {
  beforeEach(() => {
    mockIsMacOS = true;
  });

  it("omits the custom window control buttons (native traffic lights instead)", () => {
    render(<Titlebar onOpenSettings={() => {}} />);
    expect(screen.queryByRole("button", { name: "Minimize window" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Maximize window" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close window" })).toBeNull();
  });

  it("omits the Handshaker wordmark", () => {
    render(<Titlebar onOpenSettings={() => {}} />);
    expect(screen.queryByText("Handshaker")).toBeNull();
  });

  it("still renders the sidebar/settings utilities", () => {
    render(<Titlebar onOpenSettings={() => {}} />);
    expect(screen.getByRole("button", { name: "Toggle sidebar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Toggle theme" })).toBeNull();
  });

  it("renders the traffic-light inset when not fullscreen", () => {
    mockFullscreen = false;
    render(<Titlebar onOpenSettings={() => {}} />);
    expect(screen.getByTestId("mac-traffic-inset")).toBeInTheDocument();
  });

  it("collapses the traffic-light inset in fullscreen", () => {
    mockFullscreen = true;
    render(<Titlebar onOpenSettings={() => {}} />);
    expect(screen.queryByTestId("mac-traffic-inset")).toBeNull();
  });
});
