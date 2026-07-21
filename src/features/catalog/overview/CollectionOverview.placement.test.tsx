import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/ipc/client", () => ({
  ipc: {
    collectionUpsert: vi.fn().mockResolvedValue(undefined),
    collectionSetVariables: vi.fn().mockResolvedValue(undefined),
    collectionSetNodeAuth: vi.fn().mockResolvedValue(undefined),
    varsResolve: vi.fn(async (t: string) => ({ resolved: t, unresolved_vars: [], cycle_chain: null })),
    openExternal: vi.fn().mockResolvedValue(undefined),
    appSettingsSet: vi.fn().mockResolvedValue(undefined),
  },
}));

import { CollectionOverview } from "./CollectionOverview";
import { patchUiState, resetUiState } from "../uiState";
import type { CollectionIpc, CollectionLinkIpc } from "@/ipc/bindings";

function r(ui: ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

// Five links so the header variant (cap 3) must overflow the last two into "+N".
const links: CollectionLinkIpc[] = [
  { name: "Grafana", url: "https://grafana.example" },
  { name: "Logs", url: "https://logs.example" },
  { name: "Docs", url: "https://docs.example" },
  { name: "Traces", url: "https://traces.example" },
  { name: "Alerts", url: "https://alerts.example" },
];

function collection(over: Partial<CollectionIpc> = {}): CollectionIpc {
  return {
    id: "c1", name: "My Col", items: [], variables: {},
    auth: { kind: "none" }, default_tls: false, skip_tls_verify: false, pinned: false,
    description: null, created_at: 0, expanded: false, links, ...over,
  };
}

function props() {
  return { collection: collection(), onChanged: vi.fn(), onSelectRequest: vi.fn(), onClose: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetUiState(); // module-level cache is global — start every test from the strip default
});

describe("CollectionOverview — links placement", () => {
  it("strip variant (default): every chip renders, no overflow menu", () => {
    r(<CollectionOverview {...props()} />);
    for (const l of links) expect(screen.getByText(l.name)).toBeInTheDocument();
    expect(screen.queryByLabelText(/more link/)).toBeNull();
  });

  it("header variant: caps inline chips and collapses the rest into a '+N' menu", async () => {
    r(<CollectionOverview {...props()} />);
    await act(async () => {
      await patchUiState({ links_placement: "header" });
    });

    // First three inline; the last two moved into the closed overflow menu.
    expect(screen.getByText("Grafana")).toBeInTheDocument();
    expect(screen.getByText("Docs")).toBeInTheDocument();
    expect(screen.queryByText("Traces")).toBeNull();
    expect(screen.queryByText("Alerts")).toBeNull();

    // Opening the "+N" menu reveals the overflowed chips with the same labels/behaviour.
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(screen.getByLabelText("2 more links"));
    expect(screen.getByText("Traces")).toBeInTheDocument();
    expect(screen.getByText("Alerts")).toBeInTheDocument();
  });

  it("switching the setting re-renders the open panel immediately", async () => {
    r(<CollectionOverview {...props()} />);
    // Strip: all five visible.
    expect(screen.getByText("Alerts")).toBeInTheDocument();

    await act(async () => {
      await patchUiState({ links_placement: "header" });
    });
    // Header: the fifth link is now behind the overflow menu, without a remount/reload.
    expect(screen.queryByText("Alerts")).toBeNull();
    expect(screen.getByLabelText("2 more links")).toBeInTheDocument();
  });
});
