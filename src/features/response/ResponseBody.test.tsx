import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/monaco", () => ({
  MonacoEditor: ({ value, options }: { value: string; options?: { readOnly?: boolean } }) => (
    <pre data-testid="monaco" data-readonly={String(!!options?.readOnly)}>{value}</pre>
  ),
  BODY_EDIT_OPTIONS: { readOnly: false },
  BODY_READONLY_OPTIONS: { readOnly: true },
}));
vi.mock("@/lib/use-prefs", () => ({ usePrefs: () => [{}] }));

import { ResponseBody } from "./ResponseBody";

describe("ResponseBody", () => {
  it("renders the response read-only via BodyView", () => {
    render(<ResponseBody json={`{"name":"Alice"}`} />);
    const el = screen.getByTestId("monaco");
    expect(el.getAttribute("data-readonly")).toBe("true");
    expect(el.textContent).toContain("Alice");
  });
});
