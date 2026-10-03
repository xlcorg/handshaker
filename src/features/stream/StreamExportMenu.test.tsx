import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { StreamView } from "./StreamView";
import { assembleSummary } from "./exportActions";
import type { StreamEntry } from "./streamStore";
import { messages } from "@/lib/messages";
import { savedFileToast } from "@/lib/savedFileToast";

vi.mock("@/features/contract/ContractView", () => ({ ContractView: () => <div data-testid="contract" /> }));
vi.mock("@/features/bodyview/BodyView", () => ({ BodyView: () => <div data-testid="body-view" /> }));
vi.mock("@/features/response/saveResponse", () => ({ saveResponseToFile: vi.fn() }));
vi.mock("@/lib/savedFileToast", () => ({ savedFileToast: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
// Both facade shapes (named exports AND `ipc`).
const api = vi.hoisted(() => ({
  streamMessage: vi.fn(),
  streamSaveMessages: vi.fn(),
  streamAssemble: vi.fn(),
}));
vi.mock("@/ipc/client", () => ({ ...api, ipc: api }));

function entry(over: Partial<StreamEntry> = {}): StreamEntry {
  return {
    id: "s1", kind: "server", phase: "ended", halfClosed: false, sendFault: null, headers: null,
    messages: [{ dir: "in", index: 1, atMs: 1, sizeBytes: 10, preview: "{}", json: "{}" }],
    end: { statusCode: 0, statusMessage: "", statusDetails: [], trailingMetadata: {}, elapsedMs: 9, messageCount: 1, totalBytes: 10 },
    cancelled: false, fault: null, bytesFields: ["data"], authUsed: { kind: "none" }, tlsUsed: false,
    openedAt: 100_000, elapsedMs: 900, totalBytes: 10,
    ...over,
  };
}

const t = messages.stream.export;

function trigger() {
  return screen.getByRole("button", { name: t.menuAria });
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(trigger());
  return screen.findByRole("menu");
}

beforeEach(() => {
  // Reset (not clear): a failed test must not leak a `mockResolvedValueOnce` into the next.
  vi.resetAllMocks();
  api.streamSaveMessages.mockResolvedValue("/out/response-2026.json");
  api.streamAssemble.mockResolvedValue({ path: "/out/logo.png", written: 2, total: 3, size_bytes: 2048 });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("StreamExportMenu items", () => {
  it("one bytes field: Save messages + 'Assemble file from `data`…'; no submenu", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<StreamView entry={entry()} contract={null} />);
    await openMenu(user);
    expect(screen.getByRole("menuitem", { name: t.saveMessages })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t.assembleFrom("data") })).toBeInTheDocument();
    expect(screen.queryByText(t.assembleSubmenu)).toBeNull();
  });

  it("no bytes field: only Save messages", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<StreamView entry={entry({ bytesFields: [] })} contract={null} />);
    await openMenu(user);
    expect(screen.getAllByRole("menuitem")).toHaveLength(1);
    expect(screen.getByRole("menuitem", { name: t.saveMessages })).toBeInTheDocument();
    expect(screen.queryByText(/Assemble/)).toBeNull();
  });

  it("several bytes fields: an 'Assemble file from…' submenu with one item per path", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<StreamView entry={entry({ bytesFields: ["data", "meta.tag"] })} contract={null} />);
    await openMenu(user);
    const sub = screen.getByRole("menuitem", { name: t.assembleSubmenu });
    expect(sub.getAttribute("aria-haspopup")).toBe("menu");
    fireEvent.keyDown(sub, { key: "ArrowRight" });
    await screen.findByRole("menuitem", { name: t.assembleFrom("data") });
    expect(screen.getByRole("menuitem", { name: t.assembleFrom("meta.tag") })).toBeInTheDocument();
    // The top level offers only the submenu, not a flat Assemble item.
    expect(screen.getAllByRole("menuitem").filter((m) => /^Assemble file from `/.test(m.textContent ?? ""))).toHaveLength(2);
  });

  it("both items are disabled while the call is open (and after half-close), enabled after End and after Cancel", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const { rerender } = render(<StreamView entry={entry({ phase: "open", end: null, elapsedMs: null })} contract={null} />);
    await openMenu(user);
    expect(screen.getByRole("menuitem", { name: t.saveMessages }).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("menuitem", { name: t.assembleFrom("data") }).getAttribute("aria-disabled")).toBe("true");
    await user.keyboard("{Escape}");

    rerender(<StreamView entry={entry({ kind: "bidi", phase: "open", halfClosed: true, end: null, elapsedMs: null })} contract={null} />);
    await openMenu(user);
    expect(screen.getByRole("menuitem", { name: t.saveMessages }).getAttribute("aria-disabled")).toBe("true");
    await user.keyboard("{Escape}");

    rerender(<StreamView entry={entry({ end: { ...entry().end!, statusCode: 13 } })} contract={null} />);
    await openMenu(user);
    expect(screen.getByRole("menuitem", { name: t.saveMessages }).getAttribute("aria-disabled")).toBeNull();
    expect(screen.getByRole("menuitem", { name: t.assembleFrom("data") }).getAttribute("aria-disabled")).toBeNull();
    await user.keyboard("{Escape}");

    rerender(<StreamView entry={entry({ phase: "cancelled", cancelled: true, end: null })} contract={null} />);
    await openMenu(user);
    expect(screen.getByRole("menuitem", { name: t.assembleFrom("data") }).getAttribute("aria-disabled")).toBeNull();
  });

  it("both items are disabled while opening and after a fault — only End and Cancel are terminal", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const { rerender } = render(
      <StreamView entry={entry({ phase: "opening", messages: [], end: null, elapsedMs: null, bytesFields: ["data"] })} contract={null} />,
    );
    await openMenu(user);
    expect(screen.getByRole("menuitem", { name: t.saveMessages }).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("menuitem", { name: t.assembleFrom("data") }).getAttribute("aria-disabled")).toBe("true");
    await user.keyboard("{Escape}");

    const fault: StreamEntry["fault"] = { kind: "timeout", message: "deadline exceeded" };
    rerender(<StreamView entry={entry({ phase: "faulted", fault, end: null })} contract={null} />);
    await openMenu(user);
    expect(screen.getByRole("menuitem", { name: t.saveMessages }).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("menuitem", { name: t.assembleFrom("data") }).getAttribute("aria-disabled")).toBe("true");
  });
});

describe("StreamExportMenu actions", () => {
  it("Assemble calls streamAssemble(requestId, path) and toasts '<size> from N of M messages'", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<StreamView entry={entry()} contract={null} />);
    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: t.assembleFrom("data") }));

    expect(api.streamAssemble).toHaveBeenCalledWith("s1", "data");
    await waitFor(() => expect(savedFileToast).toHaveBeenCalledWith("/out/logo.png", t.assembled("2.0KB", 2, 3)));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("the toast names a cancelled stream and a non-OK end", () => {
    const r = { path: "p", written: 1, total: 2, size_bytes: 512 };
    expect(assembleSummary(entry({ phase: "cancelled", cancelled: true, end: null }), r)).toBe(
      `${t.assembled("512B", 1, 2)} · ${t.streamCancelled}`,
    );
    expect(assembleSummary(entry({ end: { ...entry().end!, statusCode: 13 } }), r)).toBe(
      `${t.assembled("512B", 1, 2)} · 13 INTERNAL`,
    );
    expect(assembleSummary(entry(), r)).toBe(t.assembled("512B", 1, 2));
  });

  it("Save messages calls streamSaveMessages(requestId) and shows the saved-file toast", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<StreamView entry={entry()} contract={null} />);
    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: t.saveMessages }));

    expect(api.streamSaveMessages).toHaveBeenCalledWith("s1");
    await waitFor(() => expect(savedFileToast).toHaveBeenCalledWith("/out/response-2026.json"));
  });

  it("a cancelled dialog (null) shows no toast; a failure shows the error toast", async () => {
    api.streamSaveMessages.mockResolvedValueOnce(null);
    api.streamAssemble.mockRejectedValueOnce({ type: "StreamFieldNotFound", request_id: "s1", field_path: "data" });
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<StreamView entry={entry()} contract={null} />);
    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: t.saveMessages }));
    await act(async () => {});
    expect(savedFileToast).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();

    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: t.assembleFrom("data") }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(messages.workflow.fault.streamFieldNotFound));
    expect(savedFileToast).not.toHaveBeenCalled();
  });
});

describe("Ctrl/Cmd+S on the stream pane", () => {
  it("saves all messages of a terminal call (same path as the menu item)", async () => {
    const { container } = render(<StreamView entry={entry()} contract={null} />);
    fireEvent.keyDown(container.firstChild as Element, { key: "s", code: "KeyS", ctrlKey: true });
    expect(api.streamSaveMessages).toHaveBeenCalledWith("s1");
    await waitFor(() => expect(savedFileToast).toHaveBeenCalledWith("/out/response-2026.json"));
  });

  it("is a no-op while the call is open", () => {
    const { container } = render(<StreamView entry={entry({ phase: "open", end: null, elapsedMs: null })} contract={null} />);
    fireEvent.keyDown(container.firstChild as Element, { key: "s", code: "KeyS", ctrlKey: true });
    expect(api.streamSaveMessages).not.toHaveBeenCalled();
  });

  it("is a no-op after a fault (no terminal End / Cancel)", () => {
    const fault: StreamEntry["fault"] = { kind: "timeout", message: "deadline exceeded" };
    const { container } = render(<StreamView entry={entry({ phase: "faulted", fault, end: null })} contract={null} />);
    fireEvent.keyDown(container.firstChild as Element, { key: "s", code: "KeyS", ctrlKey: true });
    expect(api.streamSaveMessages).not.toHaveBeenCalled();
  });
});
