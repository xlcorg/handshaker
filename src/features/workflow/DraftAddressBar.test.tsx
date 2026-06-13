import { describe, it, expect, vi } from "vitest";
import type { ReactElement } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DraftAddressBar } from "./DraftAddressBar";
import { newStep } from "./model";

const base = newStep({ address: "h:443", tls: true, service: "p.v1.S", method: "GetX" });
const cat = { services: [{ full_name: "p.v1.S", methods: [
  { name: "GetX", path: "/p.v1.S/GetX", input_message: "Req", output_message: "Res",
    client_streaming: false, server_streaming: false },
] }] };

// DraftAddressBar uses Tooltip which requires a TooltipProvider ancestor
// (supplied globally in main.tsx). Wrap renders here, same pattern as CollectionOverview.test.tsx.
function r(ui: ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

function props(over = {}) {
  return {
    step: base, catalog: null, reflecting: false, reflectError: null,
    onAddress: vi.fn(), onTls: vi.fn(), onRefresh: vi.fn(), onSelectMethod: vi.fn(),
    onSend: vi.fn(), onCancel: vi.fn(), ...over,
  };
}

describe("DraftAddressBar", () => {
  it("edits the address", () => {
    const p = props();
    r(<DraftAddressBar {...p} />);
    fireEvent.change(screen.getByLabelText("draft-address"), { target: { value: "newhost:8080" } });
    expect(p.onAddress).toHaveBeenCalledWith("newhost:8080");
  });

  it("toggles TLS via the lock (enabled → off)", () => {
    const p = props(); // base.tls === true
    r(<DraftAddressBar {...p} />);
    fireEvent.click(screen.getByLabelText("TLS enabled"));
    expect(p.onTls).toHaveBeenCalledWith(false);
  });

  it("toggles TLS via the lock (plaintext → on)", () => {
    const p = props({ step: { ...base, tls: false } });
    r(<DraftAddressBar {...p} />);
    fireEvent.click(screen.getByLabelText("Plaintext"));
    expect(p.onTls).toHaveBeenCalledWith(true);
  });

  it("shows the 'Select a method' placeholder when no method is chosen", () => {
    r(<DraftAddressBar {...props({ step: { ...base, method: "" } })} />);
    expect(screen.getByText("Select a method")).toBeInTheDocument();
  });

  it("renders the MethodPicker trigger when a method is set", () => {
    r(<DraftAddressBar {...props({ catalog: cat })} />);
    expect(screen.getByText("GetX")).toBeInTheDocument();
  });

  it("disables Send until a method is chosen", () => {
    r(<DraftAddressBar {...props({ step: { ...base, method: "" } })} />);
    expect((screen.getByRole("button", { name: /send/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("fires Send when a method is set", () => {
    const p = props();
    r(<DraftAddressBar {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(p.onSend).toHaveBeenCalledTimes(1);
  });

  it("shows Cancel (not Send) while sending and calls onCancel when clicked", () => {
    const p = props({ step: { ...base, status: "sending" } });
    r(<DraftAddressBar {...p} />);
    expect(screen.queryByRole("button", { name: /send/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(p.onCancel).toHaveBeenCalledTimes(1);
  });

  it("has no standalone refresh button in the bar (refresh lives in the dropdown)", () => {
    r(<DraftAddressBar {...props({ catalog: cat })} />);
    expect(screen.queryByLabelText("refresh-reflection")).toBeNull();
  });

  it("marks a successful resolve and shows the value inline (with room) plus a full-value tooltip", async () => {
    const resolveAddress = vi.fn(async () => ({
      resolved: "https://api.example.com/v1/notes",
      unresolved_vars: [],
      cycle_chain: null,
    }));
    r(
      <DraftAddressBar
        {...props({ step: { ...base, address: "{{host}}" }, resolveAddress, resolveKey: "k" })}
      />,
    );
    // Short address ⇒ inline value is shown, truncated, with the full value in the title.
    const inline = await screen.findByText("https://api.example.com/v1/notes");
    expect(inline.className).toContain("truncate");
    expect(inline).toHaveAttribute("title", "https://api.example.com/v1/notes");
    // Success marker is present and carries the always-available tooltip.
    const marker = screen.getByLabelText("address resolved");
    expect(marker).toHaveAttribute("title", "https://api.example.com/v1/notes");
    expect(marker.className).toContain("bg-emerald-500");
    expect(resolveAddress).toHaveBeenCalledWith("{{host}}");
  });

  it("drops the inline value for a long address but keeps the marker + tooltip", async () => {
    const longAddr = "{{host}}/api/v1/resources/items/search"; // > INLINE_RESOLVE_MAX_CHARS
    const resolveAddress = vi.fn(async () => ({
      resolved: "https://api.example.com/api/v1/resources/items/search",
      unresolved_vars: [],
      cycle_chain: null,
    }));
    r(
      <DraftAddressBar
        {...props({ step: { ...base, address: longAddr }, resolveAddress, resolveKey: "k" })}
      />,
    );
    const marker = await screen.findByLabelText("address resolved");
    expect(marker).toHaveAttribute("title", "https://api.example.com/api/v1/resources/items/search");
    // No inline value rendered (no room) — only the marker carries it.
    expect(screen.queryByText("https://api.example.com/api/v1/resources/items/search")).toBeNull();
  });

  it("marks an unresolved address with an error marker; detail is in the tooltip", async () => {
    const resolveAddress = vi.fn(async () => ({
      resolved: "{{host}}",
      unresolved_vars: ["host"],
      cycle_chain: null,
    }));
    r(
      <DraftAddressBar
        {...props({ step: { ...base, address: "{{host}}" }, resolveAddress, resolveKey: "k" })}
      />,
    );
    const marker = await screen.findByLabelText("address resolve error");
    expect(marker).toHaveAttribute("title", "Unresolved: host");
    expect(marker.className).toContain("bg-destructive");
    // No success marker, no inline value for an error.
    expect(screen.queryByLabelText("address resolved")).toBeNull();
  });

  it("renders no resolve marker when the address has no {{vars}}", () => {
    const resolveAddress = vi.fn();
    r(<DraftAddressBar {...props({ resolveAddress })} />); // base.address = "h:443"
    expect(screen.queryByLabelText(/address resolve/)).toBeNull();
    expect(resolveAddress).not.toHaveBeenCalled();
  });
});
