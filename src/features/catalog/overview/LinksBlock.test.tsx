import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

vi.mock("@/ipc/client", () => ({
  ipc: { openExternal: vi.fn().mockResolvedValue(undefined) },
}));

import { toast } from "sonner";

import { ipc } from "@/ipc/client";
import { LinksBlock } from "./LinksBlock";
import type { LinkRow } from "./linkTarget";

function r(ui: ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

const rows: LinkRow[] = [{ id: "l1", name: "Grafana", url: "https://{{host}}/d/abc" }];

function resolver(resolved: string, unresolved: string[] = [], cycle: string[] | null = null) {
  return vi.fn(async () => ({ resolved, unresolved_vars: unresolved, cycle_chain: cycle, dynamic_vars: [] }));
}

beforeEach(() => vi.clearAllMocks());

describe("LinksBlock — resolve + open", () => {
  it("opens the RESOLVED url via the opener seam", async () => {
    const resolve = resolver("https://grafana.example/d/abc");
    r(<LinksBlock rows={rows} onChange={vi.fn()} resolveUrl={resolve} resolveKey="k" />);

    const open = await screen.findByLabelText("Open link");
    await waitFor(() => expect(open).toHaveAttribute("aria-disabled", "false"));
    fireEvent.click(open);
    expect(ipc.openExternal).toHaveBeenCalledWith("https://grafana.example/d/abc");
  });

  it("opens a template-free url without asking the backend", () => {
    const resolve = resolver("unused");
    r(
      <LinksBlock
        rows={[{ id: "l1", name: "Logs", url: "https://logs.example" }]}
        onChange={vi.fn()}
        resolveUrl={resolve}
        resolveKey="k"
      />,
    );
    fireEvent.click(screen.getByLabelText("Open link"));
    expect(ipc.openExternal).toHaveBeenCalledWith("https://logs.example");
    expect(resolve).not.toHaveBeenCalled();
  });

  it("marks an unresolved link, blocks the click and names the missing vars", async () => {
    const resolve = resolver("https://{{host}}/d/abc", ["host"]);
    r(<LinksBlock rows={rows} onChange={vi.fn()} resolveUrl={resolve} resolveKey="k" />);

    const open = await screen.findByLabelText("Open link");
    await waitFor(() => expect(open.getAttribute("title")).toContain("host"));
    expect(open).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(open);
    expect(ipc.openExternal).not.toHaveBeenCalled();
  });

  it("treats a resolve cycle as unresolved", async () => {
    const resolve = resolver("{{a}}", [], ["a", "b", "a"]);
    r(<LinksBlock rows={rows} onChange={vi.fn()} resolveUrl={resolve} resolveKey="k" />);

    const open = await screen.findByLabelText("Open link");
    await waitFor(() => expect(open.getAttribute("title")).toContain("a → b → a"));
    expect(open).toHaveAttribute("aria-disabled", "true");
  });

  it("re-resolves when the resolveKey changes (environment switch)", async () => {
    const resolve = resolver("https://dev.example/d/abc");
    const { rerender } = r(
      <LinksBlock rows={rows} onChange={vi.fn()} resolveUrl={resolve} resolveKey="dev" />,
    );
    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));

    rerender(
      <TooltipProvider>
        <LinksBlock rows={rows} onChange={vi.fn()} resolveUrl={resolve} resolveKey="prod" />
      </TooltipProvider>,
    );
    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(2));
  });

  it("surfaces a rejected open (scheme outside the capability allowlist)", async () => {
    vi.mocked(ipc.openExternal).mockRejectedValueOnce("not allowed");
    r(
      <LinksBlock
        rows={[{ id: "l1", name: "Grafana", url: "grafana://board" }]}
        onChange={vi.fn()}
        resolveUrl={resolver("unused")}
        resolveKey="k"
      />,
    );
    fireEvent.click(screen.getByLabelText("Open link"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not open grafana://board"));
  });

  it("blocks the click while a templated url has not resolved yet", () => {
    const resolve = vi.fn(() => new Promise<never>(() => {}));
    r(<LinksBlock rows={rows} onChange={vi.fn()} resolveUrl={resolve} resolveKey="k" />);
    fireEvent.click(screen.getByLabelText("Open link"));
    expect(ipc.openExternal).not.toHaveBeenCalled();
  });
});
