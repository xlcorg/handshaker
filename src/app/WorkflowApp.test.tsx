import { describe, it, expect, beforeEach, vi } from "vitest";
import { render as rtlRender, screen, act, waitFor } from "@testing-library/react";
import type * as React from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import userEvent from "@testing-library/user-event";

function render(ui: React.ReactElement) {
  return rtlRender(<TooltipProvider>{ui}</TooltipProvider>);
}

vi.mock("@/features/catalog/SidebarShell", () => ({
  SidebarShell: ({
    onOpenCollection,
    onOpenRequest,
    onAddRequest,
  }: {
    onOpenCollection: (id: string) => void;
    onOpenRequest?: (collectionId: string, req: { id: string }) => void;
    onAddRequest?: () => void;
  }) => (
    <div>
      <button type="button" onClick={() => onOpenCollection("c1")}>open-col</button>
      <button type="button" onClick={() => onOpenRequest?.("c2", { id: "rX" } as never)}>open-req</button>
      <button type="button" onClick={() => onAddRequest?.()}>add-req</button>
    </div>
  ),
}));
vi.mock("@/features/catalog/overview/CollectionOverview", () => ({
  CollectionOverview: ({
    collection,
    onSelectRequest,
  }: {
    collection: { id: string };
    onSelectRequest?: (collectionId: string, req: { id: string }) => void;
  }) => (
    <div>
      OVERVIEW:{collection.id}
      <button type="button" onClick={() => onSelectRequest?.(collection.id, { id: "rZ" } as never)}>
        overview-open-req
      </button>
    </div>
  ),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn() }),
}));
vi.mock("@/features/settings/SettingsDialog", () => ({
  SettingsDialog: ({ open }: { open: boolean }) => (open ? <div>SETTINGS-DIALOG</div> : null),
}));
vi.mock("@/features/catalog/actions", () => ({
  openSavedRequest: vi.fn(),
  newRequestDraft: vi.fn(),
}));
vi.mock("@/features/catalog/save", () => ({
  saveNewRequest: vi.fn().mockResolvedValue("req-new"),
  autosaveDraft: vi.fn(),
}));
vi.mock("@/features/catalog/useAutosaveDraft", () => ({
  useAutosaveDraft: vi.fn(),
}));
vi.mock("@/features/catalog/uiState", () => ({
  loadUiState: vi.fn().mockResolvedValue({ sort_key: null, active_request: null }),
  patchUiState: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/features/catalog/SaveRequestDialog", () => ({
  SaveRequestDialog: ({
    open,
    onSave,
    defaultName,
  }: {
    open: boolean;
    onSave: (d: { collectionId: string; parentId: string | null; name: string }) => Promise<void>;
    defaultName: string;
  }) =>
    open ? (
      <button type="button" onClick={() => void onSave({ collectionId: "c1", parentId: null, name: defaultName })}>
        do-save
      </button>
    ) : null,
}));
vi.mock("@/features/catalog/DiscardDraftDialog", () => ({
  DiscardDraftDialog: ({
    open,
    onOpenChange,
    onDiscard,
    onSaveFirst,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDiscard: () => void;
    onSaveFirst: () => void;
  }) =>
    open ? (
      <div>
        <button type="button" onClick={onDiscard}>discard-confirm</button>
        <button type="button" onClick={onSaveFirst}>discard-savefirst</button>
        <button type="button" onClick={() => onOpenChange(false)}>discard-cancel</button>
      </div>
    ) : null,
}));
vi.mock("@/features/catalog/CatalogProvider", () => ({
  useCatalog: () => ({
    tree: [{ id: "c1", name: "C1", items: [], variables: {}, auth: { kind: "none" } }],
    loading: false,
    error: null,
    reload: vi.fn().mockResolvedValue(undefined),
    addItem: vi.fn().mockResolvedValue(undefined),
    createCollection: vi.fn().mockResolvedValue("c-new"),
    updateItemContent: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock("@/features/workflow/FocusView", () => ({
  FocusView: ({ onRequestSave }: { onRequestSave?: () => void }) => (
    <div>
      FOCUS
      <button type="button" onClick={() => onRequestSave?.()}>focus-save</button>
    </div>
  ),
}));
vi.mock("@/ipc/client", () => ({
  envList: vi.fn().mockResolvedValue([]),
  envActiveSet: vi.fn().mockResolvedValue(undefined),
  envActiveGet: vi.fn().mockResolvedValue(null),
  // AppVersionBadge calls ipc.appVersion(); keep it distinct from the 9.9.9 update toast
  // so findByText(/9.9.9/) stays unambiguous.
  ipc: { appVersion: vi.fn().mockResolvedValue("0.0.0-test") },
}));
vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn().mockResolvedValue({ version: "9.9.9", downloadAndInstall: vi.fn() }),
}));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

import { WorkflowApp } from "./WorkflowApp";
import { workflowStore } from "@/features/workflow/store";
import { addStep, setView } from "@/features/workflow/reducers";
import { newStep } from "@/features/workflow/model";
import { saveNewRequest } from "@/features/catalog/save";
import { openSavedRequest, newRequestDraft } from "@/features/catalog/actions";
import { envActiveGet } from "@/ipc/client";

beforeEach(() => {
  vi.clearAllMocks();
  workflowStore.reset();
});

function createCall() {
  act(() => {
    workflowStore.update((w) =>
      setView(addStep(w, newStep({ address: "h:443", tls: false, service: "p.S", method: "M" })), "focus"),
    );
  });
}
function setUnboundDraft() {
  act(() => {
    workflowStore.setDraft(newStep({ address: "h:443", tls: false, service: "p.S", method: "GetX" }));
  });
}
function setBoundDraft() {
  act(() => {
    workflowStore.setDraft(
      newStep({ address: "h:443", tls: false, service: "p.S", method: "M" }),
      { collectionId: "c1", requestId: "r1" },
    );
  });
}
function setDirtyUnboundDraft() {
  act(() => {
    workflowStore.setDraft(newStep({ address: "h:443", tls: false, service: "p.S", method: "GetX" }));
    workflowStore.updateDraft({ requestJson: '{"a":1}' });
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

  it("closes the overview and shows Focus when a request is selected from within it", async () => {
    const user = userEvent.setup();
    render(<WorkflowApp />);
    await user.click(screen.getByText("open-col"));
    expect(screen.getByText("OVERVIEW:c1")).toBeInTheDocument();
    await user.click(screen.getByText("overview-open-req"));
    expect(openSavedRequest).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("OVERVIEW:c1")).not.toBeInTheDocument();
    expect(screen.getByText("FOCUS")).toBeInTheDocument();
  });

  it("closes the overview and shows Focus when a request is opened from the sidebar", async () => {
    const user = userEvent.setup();
    render(<WorkflowApp />);
    await user.click(screen.getByText("open-col"));
    expect(screen.getByText("OVERVIEW:c1")).toBeInTheDocument();
    await user.click(screen.getByText("open-req"));
    expect(openSavedRequest).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("OVERVIEW:c1")).not.toBeInTheDocument();
    expect(screen.getByText("FOCUS")).toBeInTheDocument();
  });

  it("closes the overview and shows Focus when a new request is added", async () => {
    const user = userEvent.setup();
    render(<WorkflowApp />);
    await user.click(screen.getByText("open-col"));
    expect(screen.getByText("OVERVIEW:c1")).toBeInTheDocument();
    await user.click(screen.getByText("add-req"));
    expect(newRequestDraft).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("OVERVIEW:c1")).not.toBeInTheDocument();
    expect(screen.getByText("FOCUS")).toBeInTheDocument();
  });
});

describe("WorkflowApp titlebar + view dispatch", () => {
  it("renders the workflow selector, env control and view switcher", async () => {
    render(<WorkflowApp />);
    expect(screen.getByRole("button", { name: /workflow-1/ })).toBeInTheDocument();
    expect(await screen.findByText(/No environment/i)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Ledger" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "List" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Focus" })).toBeInTheDocument();
  });

  it("defaults to Focus and switches to the real List view", async () => {
    const user = userEvent.setup();
    render(<WorkflowApp />);
    expect(screen.getByText("FOCUS")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "List" }));
    expect(screen.queryByText("FOCUS")).not.toBeInTheDocument();
    expect(screen.getByText(/Нет шагов/)).toBeInTheDocument();
  });
});

describe("WorkflowApp Save flow", () => {
  it("opens the Save dialog on Ctrl+S for an unbound draft and binds origin on save", async () => {
    const user = userEvent.setup();
    render(<WorkflowApp />);
    setUnboundDraft();
    await user.keyboard("{Control>}s{/Control}");
    await user.click(await screen.findByText("do-save"));
    await waitFor(() => {
      expect(workflowStore.getState().draftOrigin).toEqual({
        collectionId: "c1", requestId: "req-new", collectionName: "C1", requestName: "GetX",
      });
    });
    expect(saveNewRequest).toHaveBeenCalledTimes(1);
  });

  it("does not open the Save dialog on Ctrl+S when the draft is origin-bound", async () => {
    const user = userEvent.setup();
    render(<WorkflowApp />);
    setBoundDraft();
    await user.keyboard("{Control>}s{/Control}");
    expect(screen.queryByText("do-save")).not.toBeInTheDocument();
  });

  it("opens the Save dialog from the FocusView Save button", async () => {
    const user = userEvent.setup();
    render(<WorkflowApp />);
    setUnboundDraft();
    await user.click(screen.getByText("focus-save"));
    expect(await screen.findByText("do-save")).toBeInTheDocument();
  });

  it("Ctrl+N starts a fresh request draft", async () => {
    const user = userEvent.setup();
    render(<WorkflowApp />);
    await user.keyboard("{Control>}n{/Control}");
    expect(newRequestDraft).toHaveBeenCalledTimes(1);
  });
});

describe("WorkflowApp open-over-dirty guard", () => {
  it("opens a saved request directly when there is no dirty unbound draft", async () => {
    const user = userEvent.setup();
    render(<WorkflowApp />);
    await user.click(screen.getByText("open-req"));
    expect(openSavedRequest).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("discard-confirm")).not.toBeInTheDocument();
  });

  it("prompts before replacing a dirty unbound draft, then discards", async () => {
    const user = userEvent.setup();
    render(<WorkflowApp />);
    setDirtyUnboundDraft();
    expect(workflowStore.getState().draftDirty).toBe(true);
    await user.click(screen.getByText("open-req"));
    expect(openSavedRequest).not.toHaveBeenCalled();
    expect(screen.getByText("discard-confirm")).toBeInTheDocument();
    await user.click(screen.getByText("discard-confirm"));
    expect(openSavedRequest).toHaveBeenCalledTimes(1);
  });

  it("Save first → opens the Save dialog, and after saving proceeds to open the request", async () => {
    const user = userEvent.setup();
    render(<WorkflowApp />);
    setDirtyUnboundDraft();
    await user.click(screen.getByText("open-req"));
    await user.click(screen.getByText("discard-savefirst"));
    await user.click(await screen.findByText("do-save"));
    await waitFor(() => expect(openSavedRequest).toHaveBeenCalledTimes(1));
    expect(saveNewRequest).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+S after cancelling a discard does not re-run the cancelled open", async () => {
    const user = userEvent.setup();
    render(<WorkflowApp />);
    setDirtyUnboundDraft();
    await user.click(screen.getByText("open-req")); // guarded → discard prompt
    await user.click(screen.getByText("discard-cancel")); // cancel the prompt
    // A fresh, direct Ctrl+S save of the still-unbound draft must NOT resurrect the cancelled open.
    await user.keyboard("{Control>}s{/Control}");
    await user.click(await screen.findByText("do-save"));
    await waitFor(() => expect(saveNewRequest).toHaveBeenCalledTimes(1));
    expect(openSavedRequest).not.toHaveBeenCalled();
  });
});

describe("WorkflowApp env hydration + settings", () => {
  it("hydrates the active workflow env from envActiveGet on mount", async () => {
    (envActiveGet as ReturnType<typeof vi.fn>).mockResolvedValueOnce("staging");
    render(<WorkflowApp />);
    expect(await screen.findByText("staging")).toBeInTheDocument();
  });

  it("opens the settings dialog from the titlebar settings button", async () => {
    const user = userEvent.setup();
    render(<WorkflowApp />);
    expect(screen.queryByText("SETTINGS-DIALOG")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByText("SETTINGS-DIALOG")).toBeInTheDocument();
  });
});

describe("WorkflowApp update banner", () => {
  it("shows the update banner when an update is available", async () => {
    render(<WorkflowApp />);
    expect(await screen.findByText(/9\.9\.9/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /update now/i })).toBeInTheDocument();
  });
});
