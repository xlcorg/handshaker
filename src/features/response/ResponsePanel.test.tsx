import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 22,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ key: index, index, start: index * 22, size: 22 })),
    scrollToIndex: vi.fn(),
  }),
}));

import { ResponsePanel } from "./ResponsePanel";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";

beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

const ok: InvokeOutcomeIpc = {
  status_code: 0, status_message: "OK",
  response_json: `{"id":"echo"}`, trailing_metadata: {}, elapsed_ms: 5,
};
const err: InvokeOutcomeIpc = {
  status_code: 5, status_message: "NOT_FOUND: nope",
  response_json: null, trailing_metadata: { "x-id": "1" }, elapsed_ms: 9,
};

describe("ResponsePanel", () => {
  it("renders the custom JSON tree for a successful body", () => {
    render(<ResponsePanel state="success" outcome={ok} />);
    expect(screen.getByRole("tree")).toBeInTheDocument();
    expect(screen.getByText(`"id"`)).toBeInTheDocument();
    expect(screen.getByText(`"echo"`)).toBeInTheDocument();
  });
  it("renders the Postman-style error face for a non-OK status", () => {
    render(<ResponsePanel state="error" outcome={err} />);
    // "NOT_FOUND" appears in both the RespMeta status pill (header) and the ErrorView face.
    expect(screen.getAllByText("NOT_FOUND").length).toBeGreaterThan(0);
    expect(screen.getByText("NOT_FOUND: nope")).toBeInTheDocument();
    expect(screen.queryByRole("tree")).not.toBeInTheDocument();
  });
});
