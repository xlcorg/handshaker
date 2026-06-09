import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/features/invoke/BodyEditor", () => ({
  BodyEditor: ({ value }: { value: string }) => <div data-testid="body-editor">{value}</div>,
}));

import { RequestTabs } from "./RequestTabs";
import { newStep } from "./model";

function setup(authKind: "none" | "env_var" = "none") {
  const step = { ...newStep({ address: "h", tls: false, service: "S", method: "M", requestJson: '{"a":1}' }),
    metadata: [{ key: "x", value: "1", enabled: true }] };
  const serviceAuth =
    authKind === "none"
      ? { kind: "none" as const }
      : { kind: "env_var" as const, env_var: "TOK", header_name: "authorization", prefix: "Bearer " };
  return { step, serviceAuth, onBody: vi.fn(), onMetadata: vi.fn() };
}

describe("RequestTabs", () => {
  it("shows the Request (body) pane by default", () => {
    const p = setup();
    render(<RequestTabs {...p} />);
    expect(screen.getByTestId("body-editor")).toHaveTextContent('{"a":1}');
  });

  it("switches to the Metadata pane", async () => {
    const user = userEvent.setup();
    const p = setup();
    render(<RequestTabs {...p} />);
    await user.click(screen.getByRole("tab", { name: /metadata/i }));
    expect(screen.getByLabelText("metadata-key-0")).toHaveValue("x");
  });

  it("Auth pane renders the inherited service auth read-only", async () => {
    const user = userEvent.setup();
    const p = setup("env_var");
    render(<RequestTabs {...p} />);
    await user.click(screen.getByRole("tab", { name: /auth/i }));
    expect(screen.getByText(/env_var/i)).toBeInTheDocument();
    expect(screen.getByText(/TOK/)).toBeInTheDocument();
    // read-only: no editable inputs in the Auth pane
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("does not wrap the Monaco request tab in overflow-auto (scrollbar bug)", () => {
    const p = setup();
    render(<RequestTabs {...p} />);
    const container = screen.getByTestId("body-editor").parentElement!;
    expect(container.className).toContain("overflow-hidden");
    expect(container.className).not.toContain("overflow-auto");
  });

  it("gives the Metadata tab its own scroll wrapper", async () => {
    const user = userEvent.setup();
    const p = setup();
    render(<RequestTabs {...p} />);
    await user.click(screen.getByRole("tab", { name: /metadata/i }));
    expect(screen.getByLabelText("metadata-key-0").closest(".overflow-auto")).not.toBeNull();
  });

  it("renders a tablist with underline-style tabs (no pill bg-accent on the active tab)", async () => {
    const user = userEvent.setup();
    const p = setup();
    render(<RequestTabs {...p} />);
    expect(screen.getByRole("tablist")).toBeInTheDocument();

    const requestTab = screen.getByRole("tab", { name: /request/i });
    expect(requestTab).toHaveAttribute("aria-selected", "true");
    expect(requestTab.className).not.toContain("bg-accent");

    await user.click(screen.getByRole("tab", { name: /metadata/i }));
    expect(screen.getByRole("tab", { name: /metadata/i })).toHaveAttribute("aria-selected", "true");
    expect(requestTab).toHaveAttribute("aria-selected", "false");
  });

  it("shows a Reset-to-template button on the Request tab and calls onResetTemplate", async () => {
    const user = userEvent.setup();
    const onResetTemplate = vi.fn();
    const p = { ...setup(), onResetTemplate };
    render(
      <TooltipProvider>
        <RequestTabs {...p} />
      </TooltipProvider>,
    );
    const btn = screen.getByRole("button", { name: /reset body to template/i });
    await user.click(btn);
    expect(onResetTemplate).toHaveBeenCalledTimes(1);
  });

  it("hides the Reset button when not on the Request tab", async () => {
    const user = userEvent.setup();
    const p = { ...setup(), onResetTemplate: vi.fn() };
    render(
      <TooltipProvider>
        <RequestTabs {...p} />
      </TooltipProvider>,
    );
    await user.click(screen.getByRole("tab", { name: /metadata/i }));
    expect(screen.queryByRole("button", { name: /reset body to template/i })).toBeNull();
  });

  it("disables Reset when no method is selected", () => {
    const baseStep = newStep({ address: "h", tls: false, service: "S", method: "", requestJson: "{}" });
    const p = {
      step: baseStep,
      serviceAuth: { kind: "none" as const },
      onBody: vi.fn(),
      onMetadata: vi.fn(),
      onResetTemplate: vi.fn(),
    };
    render(
      <TooltipProvider>
        <RequestTabs {...p} />
      </TooltipProvider>,
    );
    expect(screen.getByRole("button", { name: /reset body to template/i })).toBeDisabled();
  });
});
