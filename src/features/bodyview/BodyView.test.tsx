import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock the heavy Monaco module: render a textarea-ish stub, expose value/readOnly/wordWrap.
vi.mock("@/lib/monaco", () => ({
  MonacoEditor: ({ value, options }: {
    value: string;
    options?: { readOnly?: boolean; wordWrap?: string };
  }) => (
    <pre
      data-testid="monaco"
      data-readonly={String(!!options?.readOnly)}
      data-wordwrap={String(options?.wordWrap)}
    >{value}</pre>
  ),
  BODY_EDIT_OPTIONS: { readOnly: false },
  BODY_READONLY_OPTIONS: { readOnly: true },
  MONACO_THEME: "handshaker-dark",
}));
const prefs = { bodyHints: false, wordWrap: false };
vi.mock("@/lib/use-prefs", () => ({
  usePrefs: () => [prefs],
  readPrefs: () => prefs,
}));

import { createRef } from "react";
import { BodyView, type BodyViewHandle } from "./BodyView";

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

  it("passes wordWrap 'off' when the pref is off (default)", () => {
    prefs.wordWrap = false;
    render(<BodyView mode="request" value={`{"a":1}`} onChange={vi.fn()} />);
    expect(screen.getByTestId("monaco").getAttribute("data-wordwrap")).toBe("off");
  });

  it("passes wordWrap 'on' when the pref is on", () => {
    prefs.wordWrap = true;
    render(<BodyView mode="response" value={`{"a":1}`} />);
    expect(screen.getByTestId("monaco").getAttribute("data-wordwrap")).toBe("on");
    prefs.wordWrap = false; // restore — shared module-level mock object
  });

  it("exposes a collapse/expand handle (no-op before the editor mounts)", () => {
    const ref = createRef<BodyViewHandle>();
    render(<BodyView ref={ref} mode="response" value={`{"a":1}`} />);
    expect(typeof ref.current?.collapseAll).toBe("function");
    expect(typeof ref.current?.expandAll).toBe("function");
    // The Monaco stub never fires onMount, so there is no live editor — the
    // handle must guard and no-op rather than throw.
    expect(() => {
      ref.current?.collapseAll();
      ref.current?.expandAll();
    }).not.toThrow();
  });
});
