import { describe, it, expect, vi } from "vitest";
import type { ReactElement } from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DraftAddressBar } from "./DraftAddressBar";
import { newStep } from "./model";
import { messages } from "@/lib/messages";

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
    step: base, catalog: null, kind: null, reflecting: false, reflectError: null, defaultTls: false,
    onAddress: vi.fn(), onTls: vi.fn(), onRefresh: vi.fn(), onReflectCancel: vi.fn(), onSelectMethod: vi.fn(),
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

  it("cycles the lock on → off (explicit on)", () => {
    const p = props(); // base.tls === true (explicit on)
    r(<DraftAddressBar {...p} />);
    fireEvent.click(screen.getByLabelText("TLS on"));
    expect(p.onTls).toHaveBeenCalledWith(false);
  });

  it("cycles the lock off → inherit", () => {
    const p = props({ step: { ...base, tls: false } });
    r(<DraftAddressBar {...p} />);
    fireEvent.click(screen.getByLabelText("TLS off"));
    expect(p.onTls).toHaveBeenCalledWith(null);
  });

  it("cycles the lock inherit → on", () => {
    const p = props({ step: { ...base, tls: null } });
    r(<DraftAddressBar {...p} />);
    fireEvent.click(screen.getByLabelText("TLS inherit"));
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

  it("keeps Send during the busy gate, then swaps to Cancel and calls onCancel", () => {
    vi.useFakeTimers();
    try {
      const p = props({ step: { ...base, status: "sending" } });
      r(<DraftAddressBar {...p} />);
      // Sub-250ms calls never flip to Cancel — the button doesn't twitch.
      expect(screen.getByRole("button", { name: /send/i })).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(250));
      expect(screen.queryByRole("button", { name: /send/i })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
      expect(p.onCancel).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  describe("method kind badge", () => {
    it.each([
      ["server", messages.methodKind.badge.server],
      ["client", messages.methodKind.badge.client],
      ["bidi", messages.methodKind.badge.bidi],
    ] as const)("shows the %s badge next to the method", (kind, label) => {
      r(<DraftAddressBar {...props({ catalog: cat, kind })} />);
      expect(screen.getByText(label)).toBeInTheDocument();
    });

    it("shows no badge for a unary method", () => {
      r(<DraftAddressBar {...props({ catalog: cat, kind: "unary" })} />);
      for (const label of Object.values(messages.methodKind.badge)) {
        expect(screen.queryByText(label)).toBeNull();
      }
    });

    it("shows no badge and the unary Send while the kind is unknown (no catalog yet)", () => {
      r(<DraftAddressBar {...props({ catalog: null, kind: null })} />);
      for (const label of Object.values(messages.methodKind.badge)) {
        expect(screen.queryByText(label)).toBeNull();
      }
      expect(screen.getByRole("button", { name: /send/i })).toBeEnabled();
    });
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
      dynamic_vars: [],
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
      dynamic_vars: [],
    }));
    r(
      <DraftAddressBar
        {...props({ step: { ...base, address: "{{host}}" }, resolveAddress, resolveKey: "k" })}
      />,
    );
    await waitFor(() => expect(screen.getByText("{{host}}").className).toContain("vh-error"));
  });

  describe("two-way (client / bidi) controls", () => {
    const twoWay = () => ({ canSend: true, onSendMessage: vi.fn(), onHalfClose: vi.fn() });

    it.each(["client", "bidi"] as const)("idle %s method: the primary button reads ▶ Open and fires onSend", (kind) => {
      const p = props({ catalog: cat, kind });
      r(<DraftAddressBar {...p} />);
      const open = screen.getByRole("button", { name: messages.workflow.addressBar.open });
      expect(screen.queryByRole("button", { name: messages.workflow.addressBar.send })).toBeNull();
      fireEvent.click(open);
      expect(p.onSend).toHaveBeenCalledTimes(1);
    });

    it.each(["unary", "server", null] as const)("idle %s method keeps ▶ Send", (kind) => {
      r(<DraftAddressBar {...props({ catalog: cat, kind })} />);
      expect(screen.getByRole("button", { name: messages.workflow.addressBar.send })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: messages.workflow.addressBar.open })).toBeNull();
    });

    it("live two-way call: Open holds through the busy gate, then the segmented Send message / Half-close / Cancel", () => {
      vi.useFakeTimers();
      try {
        const tw = twoWay();
        const p = props({ kind: "bidi", step: { ...base, status: "sending" }, twoWay: tw });
        r(<DraftAddressBar {...p} />);
        expect(screen.getByRole("button", { name: messages.workflow.addressBar.open })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /send message/i })).toBeNull();

        act(() => vi.advanceTimersByTime(250));
        expect(screen.queryByRole("button", { name: messages.workflow.addressBar.open })).toBeNull();
        const sendMsg = screen.getByRole("button", { name: /send message/i });
        const half = screen.getByRole("button", { name: /^end stream$/i });
        const cancel = screen.getByRole("button", { name: /^cancel$/i });
        expect(sendMsg).toBeEnabled();
        expect(half).toBeEnabled();
        fireEvent.click(sendMsg);
        fireEvent.click(half);
        fireEvent.click(cancel);
        expect(tw.onSendMessage).toHaveBeenCalledTimes(1);
        expect(tw.onHalfClose).toHaveBeenCalledTimes(1);
        expect(p.onCancel).toHaveBeenCalledTimes(1);
        expect(p.onSend).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("the half-close control reads 'End stream' with a real icon, not a fallback-font glyph", () => {
      vi.useFakeTimers();
      try {
        const p = props({ kind: "bidi", step: { ...base, status: "sending" }, twoWay: twoWay() });
        r(<DraftAddressBar {...p} />);
        act(() => vi.advanceTimersByTime(250));
        const end = screen.getByRole("button", { name: "End stream" });
        expect(end.querySelector("svg")).not.toBeNull();
        expect(end.textContent).toBe("End stream");
      } finally {
        vi.useRealTimers();
      }
    });

    it("after half-close (or while opening): Send message and Half-close are disabled, Cancel stays enabled", () => {
      vi.useFakeTimers();
      try {
        const tw = { ...twoWay(), canSend: false };
        const p = props({ kind: "client", step: { ...base, status: "sending" }, twoWay: tw });
        r(<DraftAddressBar {...p} />);
        act(() => vi.advanceTimersByTime(250));
        expect(screen.getByRole("button", { name: /send message/i })).toBeDisabled();
        expect(screen.getByRole("button", { name: /^end stream$/i })).toBeDisabled();
        const cancel = screen.getByRole("button", { name: /^cancel$/i });
        expect(cancel).toBeEnabled();
        fireEvent.click(cancel);
        expect(p.onCancel).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("live server stream (no twoWay) keeps the lone Cancel — no Send message / Half-close", () => {
      vi.useFakeTimers();
      try {
        r(<DraftAddressBar {...props({ kind: "server", step: { ...base, status: "sending" } })} />);
        act(() => vi.advanceTimersByTime(250));
        expect(screen.getByRole("button", { name: /^cancel$/i })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /send message/i })).toBeNull();
        expect(screen.queryByRole("button", { name: /^end stream$/i })).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
