import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SidebarProvider } from "@/components/ui/sidebar";
import type { ItemIpc } from "@/ipc/bindings";
import type { TreeCallbacks } from "@/features/catalog/treeTypes";
import { vi } from "vitest";
import { AppearancePane } from "./AppearancePane";
import { RequestRow } from "@/features/catalog/RequestRow";
import { readPrefs } from "@/lib/use-prefs";

/** Reset the module-level prefs singleton and localStorage between tests. */
function resetPrefs() {
  localStorage.clear();
  // Re-render a pane and click "solid" to broadcast the default back to the store.
  const { unmount } = render(<AppearancePane />);
  const grpcTextEl = screen.getByText("gRPC icon");
  const rowEl = grpcTextEl.closest("div.flex") as HTMLElement;
  fireEvent.click(within(rowEl).getByLabelText("solid"));
  unmount();
}

beforeEach(() => {
  resetPrefs();
});

function req(name: string): Extract<ItemIpc, { type: "request" }> {
  return {
    type: "request", id: "r1", name, address_template: "h:443", service: "p.v1.S",
    method: "GetX", body_template: "{}", metadata: [], auth: { kind: "none" },
    tls_override: null, last_used_at: null, use_count: 0,
  };
}

function makeCb(over: Partial<TreeCallbacks> = {}): TreeCallbacks {
  return {
    open: new Set(), activeItemId: null, activeCollectionId: null, focusedId: null, editingId: null,
    onToggle: vi.fn(), onEditingChange: vi.fn(), onOpenRequest: vi.fn(),
    onOpenCollection: vi.fn(), onRenameItem: vi.fn(), onRenameCollection: vi.fn(),
    onDuplicateItem: vi.fn(), onRequestDeleteItem: vi.fn(), onRequestDeleteCollection: vi.fn(),
    onExportCollection: vi.fn(),
    onAddRequest: vi.fn(), onAddFolder: vi.fn(), onSetPinned: vi.fn(),
    dragId: null, dropHint: null, onDragStartItem: vi.fn(), onDragOverRow: vi.fn(),
    onDropRow: vi.fn(), onDragEndItem: vi.fn(), ...over,
  };
}

describe("AppearancePane zoom row", () => {
  it("steps zoom by 10% and resets", async () => {
    const user = userEvent.setup();
    render(<AppearancePane />);
    // default 100%, Reset hidden
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reset zoom" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText("110%")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reset zoom" }));
    expect(screen.getByText("100%")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(screen.getByText("90%")).toBeInTheDocument();
    // restore default so it doesn't leak into sibling tests
    await user.click(screen.getByRole("button", { name: "Reset zoom" }));
  });
});

describe("AppearancePane", () => {
  it("gRPC icon toggle updates the pref", () => {
    render(<AppearancePane />);
    // "gRPC icon" text is inside div.text-[12.5px] > div.grid.gap-0.5 > div.flex (SettingsRow root)
    // Go up two levels: text div -> grid div -> row div (flex items-center justify-between)
    const grpcTextEl = screen.getByText("gRPC icon");
    const rowEl = grpcTextEl.closest("div.flex") as HTMLElement;
    const outlineBtn = within(rowEl).getByLabelText("outline");
    fireEvent.click(outlineBtn);
    expect(readPrefs().grpcIcon).toBe("outline");
  });

  it("method list style dropdown updates the pref", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<AppearancePane />);
    await user.click(screen.getByLabelText("method-list-style"));
    await user.click(screen.getByText("Tree"));
    expect(readPrefs().methodGroupStyle).toBe("tree");
  });

  it("variable highlight scheme dropdown updates the pref", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<AppearancePane />);
    await user.click(screen.getByLabelText("var-highlight-scheme"));
    await user.click(screen.getByText("Amber"));
    expect(readPrefs().varHighlight).toBe("amber");
  });

  it("word wrap switch toggles the pref", () => {
    render(<AppearancePane />);
    // default is false (PREFS_DEFAULTS); resetPrefs() / no prior test touches wordWrap.
    expect(readPrefs().wordWrap).toBe(false);
    const row = screen.getByText("Word wrap").closest("div.flex") as HTMLElement;
    fireEvent.click(within(row).getByRole("switch"));
    expect(readPrefs().wordWrap).toBe(true);
  });

  it("switching the toggle re-renders the request row icon live", () => {
    render(
      <SidebarProvider>
        <AppearancePane />
        <RequestRow collectionId="c1" req={req("Test")} cb={makeCb()} />
      </SidebarProvider>,
    );

    // Icon starts as solid (default)
    const icon = screen.getByLabelText("grpc");
    expect(icon.getAttribute("data-variant")).toBe("solid");

    // Click the "circle" option in the gRPC icon ToggleGroup
    const grpcTextEl = screen.getByText("gRPC icon");
    const rowEl = grpcTextEl.closest("div.flex") as HTMLElement;
    const circleBtn = within(rowEl).getByLabelText("circle");
    fireEvent.click(circleBtn);

    // Icon should now be circle
    expect(screen.getByLabelText("grpc").getAttribute("data-variant")).toBe("circle");
  });

  it("selecting 'off' hides the request row icon but keeps the label", () => {
    render(
      <SidebarProvider>
        <AppearancePane />
        <RequestRow collectionId="c1" req={req("Test")} cb={makeCb()} />
      </SidebarProvider>,
    );

    // Icon present at the default "solid".
    expect(screen.getByLabelText("grpc")).toBeInTheDocument();

    // Click the "off" option in the gRPC icon ToggleGroup.
    const grpcTextEl = screen.getByText("gRPC icon");
    const rowEl = grpcTextEl.closest("div.flex") as HTMLElement;
    fireEvent.click(within(rowEl).getByLabelText("off"));

    // pref is "off", icon gone, request label still rendered (text took the space).
    expect(readPrefs().grpcIcon).toBe("off");
    expect(screen.queryByLabelText("grpc")).toBeNull();
    expect(screen.getByText("Test")).toBeInTheDocument();
  });
});
