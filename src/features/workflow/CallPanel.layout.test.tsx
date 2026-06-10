import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/features/invoke/BodyEditor", () => ({
  BodyEditor: ({ value }: { value: string }) => <div data-testid="body-editor">{value}</div>,
}));
vi.mock("@/ipc/client", () => ({
  authResolve: vi.fn().mockResolvedValue(null),
  grpcDescribe: vi.fn().mockResolvedValue({ services: [] }),
  grpcRefreshContract: vi.fn().mockResolvedValue({ services: [] }),
  grpcBuildRequestSkeleton: vi.fn().mockResolvedValue("{}"),
  varsResolve: vi.fn(),
  grpcInvokeOneshot: vi.fn(),
  grpcCancel: vi.fn(),
}));

// Mutable prefs the mock reads; flip `split` per test (vi.hoisted so the
// factory can reference it despite hoisting).
const h = vi.hoisted(() => ({ split: "vertical" as "horizontal" | "vertical" }));
vi.mock("@/lib/use-prefs", () => ({
  usePrefs: () => [{ split: h.split, bodyPanel: 50, theme: "dark" }, vi.fn()],
  readPrefs: () => ({ split: h.split, bodyPanel: 50, theme: "dark" }),
}));

import { CallPanel } from "./CallPanel";
import { newStep } from "./model";

const draft = newStep({ address: "h:443", tls: true, service: "p.v1.S", method: "GetX" });

function renderCallPanel(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

beforeEach(() => {
  h.split = "vertical";
  vi.clearAllMocks();
});

describe("CallPanel body layout", () => {
  it("renders a resizable group with request + response panels and a handle", () => {
    const { container } = renderCallPanel(<CallPanel step={draft} onPatch={() => {}} />);
    expect(container.querySelector('[data-slot="resizable-panel-group"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-slot="resizable-panel"]').length).toBe(2);
    expect(container.querySelector('[data-slot="resizable-handle"]')).not.toBeNull();
  });

  // The react-resizable-panels v4 fork reflects orientation via the group's
  // inline `flex-direction` style ("row" = horizontal, "column" = vertical) —
  // NOT via aria-orientation/data-orientation (verified against the installed fork).
  it("maps split='vertical' (Left/Right) to a row-direction (horizontal) group", () => {
    const { container } = renderCallPanel(<CallPanel step={draft} onPatch={() => {}} />);
    const group = container.querySelector('[data-slot="resizable-panel-group"]') as HTMLElement;
    expect(group.style.flexDirection).toBe("row");
  });

  it("maps split='horizontal' (Top/Bottom) to a column-direction (vertical) group", () => {
    h.split = "horizontal";
    const { container } = renderCallPanel(<CallPanel step={draft} onPatch={() => {}} />);
    const group = container.querySelector('[data-slot="resizable-panel-group"]') as HTMLElement;
    expect(group.style.flexDirection).toBe("column");
  });
});
