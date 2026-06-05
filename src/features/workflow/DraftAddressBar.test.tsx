import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DraftAddressBar } from "./DraftAddressBar";
import { newStep } from "./model";

const base = newStep({ address: "h:443", tls: true, service: "p.v1.S", method: "GetX" });
const cat = { services: [{ full_name: "p.v1.S", methods: [
  { name: "GetX", path: "/p.v1.S/GetX", input_message: "Req", output_message: "Res",
    client_streaming: false, server_streaming: false },
] }] };

function props(over = {}) {
  return {
    step: base, catalog: null, reflecting: false, reflectError: null,
    onAddress: vi.fn(), onRefresh: vi.fn(), onSelectMethod: vi.fn(),
    onSend: vi.fn(), onCancel: vi.fn(), ...over,
  };
}

describe("DraftAddressBar", () => {
  it("edits the address", () => {
    const p = props();
    render(<DraftAddressBar {...p} />);
    fireEvent.change(screen.getByLabelText("draft-address"), { target: { value: "newhost:8080" } });
    expect(p.onAddress).toHaveBeenCalledWith("newhost:8080");
  });

  it("fires refresh", () => {
    const p = props();
    render(<DraftAddressBar {...p} />);
    fireEvent.click(screen.getByLabelText("refresh-reflection"));
    expect(p.onRefresh).toHaveBeenCalledTimes(1);
  });

  it("shows the reflect error when there is no catalog", () => {
    render(<DraftAddressBar {...props({ reflectError: "no reflection here" })} />);
    expect(screen.getByText("no reflection here")).toBeTruthy();
  });

  it("renders the MethodPicker trigger when a catalog is loaded", () => {
    render(<DraftAddressBar {...props({ catalog: cat })} />);
    expect(screen.getByText("GetX")).toBeTruthy(); // method name in the trigger
  });

  it("disables Send until a method is chosen", () => {
    const noMethod = { ...base, method: "" };
    render(<DraftAddressBar {...props({ step: noMethod })} />);
    expect((screen.getByRole("button", { name: /send/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("fires Send when a method is set", () => {
    const p = props();
    render(<DraftAddressBar {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(p.onSend).toHaveBeenCalledTimes(1);
  });
});
