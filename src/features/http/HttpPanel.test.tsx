import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  CallRecordIpc,
  HistoryPageIpc,
  HttpResponseIpc,
  HttpSendReportIpc,
  HttpTemplateIpc,
} from "@/ipc/bindings";
import { TooltipProvider } from "@/components/ui/tooltip";

// Monaco never mounts in jsdom; the stub exposes what the panel wires into it.
vi.mock("@/features/bodyview/BodyView", () => ({
  BodyView: ({
    value,
    mode,
    language,
  }: {
    value: string;
    mode: string;
    language?: string;
  }) => (
    <pre
      data-testid={`body-view-${mode}`}
      data-language={language ?? "json-with-vars"}
    >
      {value}
    </pre>
  ),
}));
vi.mock("@/features/workflow/CallPanel", () => ({
  CallPanel: () => <div>GRPC-CALL-PANEL</div>,
}));

const api = vi.hoisted(() => ({
  httpSend: vi.fn<(...a: unknown[]) => Promise<HttpSendReportIpc>>(),
  grpcCancel: vi.fn().mockResolvedValue(undefined),
  historyRecord: vi.fn<(r: CallRecordIpc) => Promise<HistoryPageIpc>>(),
  authEffective: vi.fn().mockResolvedValue({ kind: "none" }),
  envList: vi.fn().mockResolvedValue([]),
  envActiveSet: vi.fn().mockResolvedValue(undefined),
  varsResolve: vi
    .fn()
    .mockResolvedValue({
      resolved: "",
      unresolved_vars: [],
      cycle_chain: null,
      dynamic_vars: [],
    }),
}));
vi.mock("@/ipc/client", () => ({ ...api, ipc: api }));

const cat = vi.hoisted(() => ({ bumpUsage: vi.fn(() => Promise.resolve()) }));
vi.mock("@/features/catalog/CatalogProvider", () => ({
  useCatalog: () => ({
    tree: [],
    duplicateItem: vi.fn(),
    renameItem: vi.fn(),
    bumpUsage: cat.bumpUsage,
  }),
}));
vi.mock("@/features/catalog/uiState", () => ({ patchUiState: vi.fn() }));

import { FocusView } from "@/features/workflow/FocusView";
import { workflowStore } from "@/features/workflow/store";
import { newHttpStep } from "./model";
import { narrow } from "@/test/narrow";
import { messages } from "@/lib/messages";

async function renderFocus() {
  const result = render(
    <TooltipProvider>
      <FocusView onRequestSave={vi.fn()} />
    </TooltipProvider>,
  );
  await act(async () => {});
  return result;
}

const template: HttpTemplateIpc = {
  method: "GET",
  url_template: "{{base}}/ping",
  query: [],
  headers: [],
  body: { kind: "none" },
  auth: { kind: "none" },
};

const response: HttpResponseIpc = {
  status: 404,
  reason: "Not Found",
  headers: [{ name: "content-type", value: "text/plain" }],
  body: { type: "text", text: "nope" },
  size_bytes: 4,
  elapsed_ms: 12,
};

const httpDraft = () => narrow(workflowStore.getState().draft, "http");

beforeEach(() => {
  vi.clearAllMocks();
  api.historyRecord.mockResolvedValue({ revision: 1, rows: [] });
  workflowStore.reset();
});

describe("Focus with an HTTP draft", () => {
  it("shows the HTTP panel, not the gRPC call panel, with Send off until there is a URL", async () => {
    workflowStore.setDraft(newHttpStep());
    await renderFocus();

    expect(screen.queryByText("GRPC-CALL-PANEL")).not.toBeInTheDocument();
    expect(screen.getByTestId("draft-breadcrumb")).toHaveTextContent(
      "New HTTP request",
    );
    expect(screen.getByLabelText(messages.http.addressBar.method)).toHaveTextContent(
      "GET",
    );
    expect(screen.getByLabelText(messages.http.addressBar.url)).toHaveValue("");
    expect(
      screen.getByRole("button", { name: messages.workflow.addressBar.send }),
    ).toBeDisabled();
    expect(
      screen.getByText(messages.http.response.idleTitle),
    ).toBeInTheDocument();
  });

  it("method and URL edits land on the draft's template and mark the unbound draft dirty", async () => {
    const user = userEvent.setup();
    workflowStore.setDraft(newHttpStep());
    await renderFocus();

    const method = screen.getByLabelText(messages.http.addressBar.method);
    fireEvent.keyDown(method, { key: "Enter" });
    await user.click(await screen.findByRole("menuitemradio", { name: "DELETE" }));
    fireEvent.change(screen.getByLabelText(messages.http.addressBar.url), {
      target: { value: "https://api.test/users/7" },
    });

    expect(httpDraft().template).toEqual({
      ...template,
      method: "DELETE",
      url_template: "https://api.test/users/7",
    });
    expect(workflowStore.getState().draftDirty).toBe(true);
    expect(screen.getByTestId("draft-dirty-dot")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: messages.workflow.addressBar.send }),
    ).toBeEnabled();
  });

  it("Send passes the template and resolve context, then shows status, reason, body and headers", async () => {
    const user = userEvent.setup();
    api.httpSend.mockResolvedValue({ response, auth_used: { kind: "none" } });
    workflowStore.setDraft(newHttpStep({ template }));
    await renderFocus();

    await user.click(
      screen.getByRole("button", { name: messages.workflow.addressBar.send }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("http-response-meta")).toHaveTextContent(
        "404Not Found",
      ),
    );
    expect(api.httpSend).toHaveBeenCalledTimes(1);
    expect(api.httpSend.mock.calls[0].slice(0, 2)).toEqual([
      template,
      { collection_id: null, env_name: null },
    ]);
    const body = screen.getByTestId("body-view-response");
    expect(body).toHaveTextContent("nope");
    expect(body).toHaveAttribute("data-language", "plaintext");
    expect(workflowStore.getState().draftDirty).toBe(false);

    await user.click(screen.getByRole("tab", { name: /^Headers\s*1$/ }));
    expect(screen.getByText("content-type")).toBeInTheDocument();
    expect(screen.getByText("text/plain")).toBeInTheDocument();
  });

  it("a send that fails before any exchange shows the fault and no response meta", async () => {
    const user = userEvent.setup();
    api.httpSend.mockRejectedValue({
      type: "UnresolvedVars",
      unresolved: ["base"],
      cycle: null,
    });
    workflowStore.setDraft(newHttpStep({ template }));
    await renderFocus();

    await user.click(
      screen.getByRole("button", { name: messages.workflow.addressBar.send }),
    );

    await waitFor(() =>
      expect(
        screen.getByText("Unresolved variables: {{base}}"),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("http-response-meta")).not.toBeInTheDocument();
    expect(httpDraft().run).toEqual({
      status: "error",
      error: { kind: "other", message: "Unresolved variables: {{base}}" },
    });
  });
});
