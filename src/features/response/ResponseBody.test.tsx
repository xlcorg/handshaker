import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/monaco", () => ({
  MonacoEditor: ({ value }: { value: string }) => <pre data-testid="monaco">{value}</pre>,
  BODY_EDIT_OPTIONS: { readOnly: false },
  BODY_READONLY_OPTIONS: { readOnly: true },
  MONACO_THEME: "handshaker-dark",
}));
vi.mock("@/lib/use-prefs", () => ({ usePrefs: () => [{}], readPrefs: () => ({}) }));
vi.mock("@/ipc/client", () => ({ base64Inspect: vi.fn(), base64Save: vi.fn() }));

import { ResponseBody } from "./ResponseBody";

describe("ResponseBody", () => {
  it("renders the body and no decode dialog initially", () => {
    render(<ResponseBody json={`{"a":1}`} />);
    expect(screen.getByTestId("monaco").textContent).toContain(`{"a":1}`);
    expect(screen.queryByText("Decoded")).not.toBeInTheDocument();
  });
});
