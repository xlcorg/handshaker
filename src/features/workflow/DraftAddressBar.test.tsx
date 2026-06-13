import { describe, it, expect, vi } from "vitest";
import type { ReactElement } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

  it("highlights a resolved {{var}} token and renders the resolved value", async () => {
    const resolveAddress = vi.fn(async () => ({
      resolved: "localhost:5002",
      unresolved_vars: [],
      cycle_chain: null,
    }));
    r(
      <DraftAddressBar
        {...props({ step: { ...base, address: "{{host}}" }, resolveAddress, resolveKey: "k" })}
      />,
    );
    await waitFor(() => expect(screen.getByText("{{host}}").className).toContain("vh-resolved"));
    expect(screen.getByText("localhost:5002")).toBeInTheDocument(); // inline resolved value
    expect(resolveAddress).toHaveBeenCalledWith("{{host}}");
  });

  it("highlights an unresolved {{var}} token as an error", async () => {
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
    await waitFor(() => expect(screen.getByText("{{host}}").className).toContain("vh-error"));
  });
});
