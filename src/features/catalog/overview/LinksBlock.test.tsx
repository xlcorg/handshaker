import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState, type ReactElement } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { VarCandidate } from "@/features/vars/candidates";

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

describe("LinksBlock — drag reorder", () => {
  const three: LinkRow[] = [
    { id: "a", name: "A", url: "https://a.example" },
    { id: "b", name: "B", url: "https://b.example" },
    { id: "c", name: "C", url: "https://c.example" },
  ];

  function rowOf(index: number): HTMLElement {
    return screen.getAllByLabelText("link name")[index].parentElement as HTMLElement;
  }

  it("dragging a grip onto another row fires onChange with the full new order", () => {
    const onChange = vi.fn();
    r(<LinksBlock rows={three} onChange={onChange} resolveUrl={resolver("x")} resolveKey="k" />);

    // jsdom getBoundingClientRect has zero height, so every dragOver resolves to zone "before".
    fireEvent.dragStart(screen.getAllByLabelText("Reorder link")[2]); // drag c
    fireEvent.dragOver(rowOf(0), { clientY: 5 }); // before a
    fireEvent.drop(rowOf(0), { clientY: 5 });

    expect(onChange).toHaveBeenCalledWith([three[2], three[0], three[1]]);
  });

  it("a no-op drop (same resulting order) does not fire onChange", () => {
    const onChange = vi.fn();
    r(<LinksBlock rows={three} onChange={onChange} resolveUrl={resolver("x")} resolveKey="k" />);

    fireEvent.dragStart(screen.getAllByLabelText("Reorder link")[0]); // drag a
    fireEvent.dragOver(rowOf(1), { clientY: 5 }); // before b ⇒ a stays where it is
    fireEvent.drop(rowOf(1), { clientY: 5 });

    expect(onChange).not.toHaveBeenCalled();
  });
});

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
    // The URL field (VarHighlightInput) also resolves, so the row resolves more than once
    // per key — assert the key change triggers a fresh resolve, not an exact call count.
    await waitFor(() => expect(resolve).toHaveBeenCalled());
    const before = resolve.mock.calls.length;

    rerender(
      <TooltipProvider>
        <LinksBlock rows={rows} onChange={vi.fn()} resolveUrl={resolve} resolveKey="prod" />
      </TooltipProvider>,
    );
    await waitFor(() => expect(resolve.mock.calls.length).toBeGreaterThan(before));
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

describe("LinksBlock — URL field variable treatment", () => {
  it("highlights the {{var}} token in the URL and previews the resolved value", async () => {
    const resolve = resolver("https://grafana.example/d/abc");
    r(<LinksBlock rows={rows} onChange={vi.fn()} resolveUrl={resolve} resolveKey="k" />);

    // Token segment painted as resolved (green), literal segments left plain.
    await waitFor(() => expect(screen.getByText("{{host}}").className).toContain("vh-resolved"));
    // Inline resolve preview shows the substituted value while editing.
    expect(screen.getByText("https://grafana.example/d/abc")).toBeInTheDocument();
  });

  it("marks the token as an error when the URL does not resolve", async () => {
    const resolve = resolver("https://{{host}}/d/abc", ["host"]);
    r(<LinksBlock rows={rows} onChange={vi.fn()} resolveUrl={resolve} resolveKey="k" />);

    await waitFor(() => expect(screen.getByText("{{host}}").className).toContain("vh-error"));
  });

  it("offers {{-autocomplete over the supplied variable candidates", async () => {
    const resolve = resolver("");
    const variables: VarCandidate[] = [{ name: "host", value: "grafana.example", origin: "collection" }];

    function Host() {
      const [rs, setRs] = useState<LinkRow[]>([{ id: "l1", name: "", url: "" }]);
      return (
        <LinksBlock rows={rs} onChange={setRs} resolveUrl={resolve} resolveKey="k" variables={variables} />
      );
    }
    r(<Host />);

    const url = screen.getByLabelText("link URL");
    fireEvent.change(url, { target: { value: "{{ho" } });
    fireEvent.keyUp(url, { key: "o" });

    await waitFor(() => expect(screen.getByText("host")).toBeInTheDocument());
  });
});
