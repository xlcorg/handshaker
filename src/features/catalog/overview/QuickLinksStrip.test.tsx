import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

vi.mock("@/ipc/client", () => ({
  ipc: { openExternal: vi.fn().mockResolvedValue(undefined) },
}));

import { ipc } from "@/ipc/client";
import { QuickLinksStrip } from "./QuickLinksStrip";
import type { LinkRow } from "./linkTarget";

function r(ui: ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

function resolver(resolved: string, unresolved: string[] = [], cycle: string[] | null = null) {
  return vi.fn(async () => ({
    resolved,
    unresolved_vars: unresolved,
    cycle_chain: cycle,
    dynamic_vars: [],
  }));
}

const rows: LinkRow[] = [{ id: "l1", name: "Grafana", url: "https://{{host}}/d/abc" }];

beforeEach(() => vi.clearAllMocks());

describe("QuickLinksStrip — chips", () => {
  it("a ready chip opens the RESOLVED url via the opener seam", async () => {
    const resolve = resolver("https://grafana.example/d/abc");
    r(<QuickLinksStrip rows={rows} onChange={vi.fn()} resolveUrl={resolve} resolveKey="k" />);
    const chip = screen.getByText("Grafana").closest("button") as HTMLButtonElement;
    await waitFor(() => expect(chip).toHaveAttribute("aria-disabled", "false"));
    fireEvent.click(chip);
    expect(ipc.openExternal).toHaveBeenCalledWith("https://grafana.example/d/abc");
  });

  it("a broken chip is inert and its title names the missing vars", async () => {
    const resolve = resolver("https://{{host}}/d/abc", ["host"]);
    r(<QuickLinksStrip rows={rows} onChange={vi.fn()} resolveUrl={resolve} resolveKey="k" />);
    const chip = screen.getByText("Grafana").closest("button") as HTMLButtonElement;
    await waitFor(() => expect(chip.getAttribute("title")).toContain("host"));
    expect(chip).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(chip);
    expect(ipc.openExternal).not.toHaveBeenCalled();
  });

  it("a still-resolving chip is inert", () => {
    const resolve = vi.fn(() => new Promise<never>(() => {}));
    r(<QuickLinksStrip rows={rows} onChange={vi.fn()} resolveUrl={resolve} resolveKey="k" />);
    const chip = screen.getByText("Grafana").closest("button") as HTMLButtonElement;
    expect(chip).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(chip);
    expect(ipc.openExternal).not.toHaveBeenCalled();
  });

  it("labels an unnamed link by its URL host", () => {
    r(
      <QuickLinksStrip
        rows={[{ id: "l1", name: "  ", url: "https://logs.example/app" }]}
        onChange={vi.fn()}
        resolveUrl={resolver("unused")}
        resolveKey="k"
      />,
    );
    expect(screen.getByText("logs.example")).toBeInTheDocument();
  });

  it("shows a single ghost 'Add link' chip when there are no links", () => {
    r(<QuickLinksStrip rows={[]} onChange={vi.fn()} resolveUrl={resolver("x")} resolveKey="k" />);
    expect(screen.getByText("Add link")).toBeInTheDocument();
    expect(screen.queryByLabelText("Edit links")).toBeNull();
  });

  it("the ghost chip opens the edit dialog", () => {
    r(<QuickLinksStrip rows={[]} onChange={vi.fn()} resolveUrl={resolver("x")} resolveKey="k" />);
    fireEvent.click(screen.getByText("Add link"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("the pencil opens the dialog and edits round-trip through onChange", () => {
    const onChange = vi.fn();
    r(<QuickLinksStrip rows={rows} onChange={onChange} resolveUrl={resolver("x")} resolveKey="k" />);
    fireEvent.click(screen.getByLabelText("Edit links"));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("link name"), { target: { value: "Dash" } });
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ name: "Dash", url: "https://{{host}}/d/abc" }),
    ]);
  });
});
