import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock the heavy Monaco module: render a textarea-ish stub, expose value/readOnly.
vi.mock("@/lib/monaco", () => ({
  MonacoEditor: ({ value, options }: {
    value: string;
    options?: { readOnly?: boolean };
  }) => (
    <pre
      data-testid="monaco"
      data-readonly={String(!!options?.readOnly)}
    >{value}</pre>
  ),
  BODY_EDIT_OPTIONS: { readOnly: false },
  BODY_READONLY_OPTIONS: { readOnly: true },
}));
const prefs = { bodyHints: false };
vi.mock("@/lib/use-prefs", () => ({
  usePrefs: () => [prefs],
  readPrefs: () => prefs,
}));

import { BodyView } from "./BodyView";

// NOTE: the mocked MonacoEditor does NOT invoke onMount, so the imperative
// response render (parse → renderJsonTree → model.setValue) does not run here.
// Pretty-print / elision / badge-expand are covered by the pure-unit tests
// (parse/render) and controller.test; this smoke test only checks prop plumbing
// (which mode wires editable vs read-only, and that the value reaches Monaco).
describe("BodyView", () => {
  it("request mode is editable and passes the value through", () => {
    render(<BodyView mode="request" value={`{"a":1}`} onChange={vi.fn()} />);
    const el = screen.getByTestId("monaco");
    expect(el.textContent).toBe(`{"a":1}`);
    expect(el.getAttribute("data-readonly")).toBe("false");
  });

  it("response mode is read-only", () => {
    render(<BodyView mode="response" value={`{"a":1}`} />);
    expect(screen.getByTestId("monaco").getAttribute("data-readonly")).toBe("true");
  });
});
