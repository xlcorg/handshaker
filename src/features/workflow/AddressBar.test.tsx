import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AddressBar } from "./AddressBar";
import { newStep } from "./model";

const base = newStep({ address: "h:443", tls: true, service: "S", method: "M" });

describe("AddressBar cancel", () => {
  it("shows Send (not Cancel) when idle", () => {
    render(<AddressBar step={base} onSend={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole("button", { name: /send/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
  });

  it("shows Cancel while sending and calls onCancel when clicked", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<AddressBar step={{ ...base, status: "sending" }} onSend={() => {}} onCancel={onCancel} />);
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
