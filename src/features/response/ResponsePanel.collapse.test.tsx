import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import type { BodyViewHandle } from "@/features/bodyview/BodyView";

// Replace ResponseBody with a forwardRef stub that exposes a spy handle, so we
// can assert the header buttons drive the body without booting Monaco.
const handle = { collapseAll: vi.fn(), expandAll: vi.fn() };
vi.mock("./ResponseBody", () => ({
  ResponseBody: forwardRef<BodyViewHandle, { json: string }>(function ResponseBody(_props, ref) {
    useImperativeHandle(ref, () => handle, []);
    return <pre data-testid="body-stub" />;
  }),
}));
vi.mock("@/lib/use-prefs", () => ({ usePrefs: () => [{}] }));

import { ResponsePanel } from "./ResponsePanel";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";

const ok: InvokeOutcomeIpc = {
  status_code: 0,
  status_message: "OK",
  response_json: `{"id":"echo"}`,
  trailing_metadata: {},
  elapsed_ms: 5,
};

beforeEach(() => {
  handle.collapseAll.mockClear();
  handle.expandAll.mockClear();
});

describe("ResponsePanel collapse/expand wiring", () => {
  it("Collapse all calls the body handle", () => {
    render(<ResponsePanel state="success" outcome={ok} />);
    fireEvent.click(screen.getByRole("button", { name: "collapse all" }));
    expect(handle.collapseAll).toHaveBeenCalledTimes(1);
    expect(handle.expandAll).not.toHaveBeenCalled();
  });

  it("Expand all calls the body handle", () => {
    render(<ResponsePanel state="success" outcome={ok} />);
    fireEvent.click(screen.getByRole("button", { name: "expand all" }));
    expect(handle.expandAll).toHaveBeenCalledTimes(1);
    expect(handle.collapseAll).not.toHaveBeenCalled();
  });
});
