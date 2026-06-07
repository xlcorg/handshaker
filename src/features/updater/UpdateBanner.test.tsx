import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UpdateBanner } from "./UpdateBanner";

describe("UpdateBanner", () => {
  it("shows the available version and both actions", () => {
    render(
      <UpdateBanner phase="available" version="0.2.0" progress={0} onUpdate={() => {}} onDismiss={() => {}} />,
    );
    expect(screen.getByText(/0\.2\.0/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /update now/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /later/i })).toBeInTheDocument();
  });

  it("calls onUpdate when 'Update now' is clicked", async () => {
    const onUpdate = vi.fn();
    const user = userEvent.setup();
    render(
      <UpdateBanner phase="available" version="0.2.0" progress={0} onUpdate={onUpdate} onDismiss={() => {}} />,
    );
    await user.click(screen.getByRole("button", { name: /update now/i }));
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("calls onDismiss when 'Later' is clicked", async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    render(
      <UpdateBanner phase="available" version="0.2.0" progress={0} onUpdate={() => {}} onDismiss={onDismiss} />,
    );
    await user.click(screen.getByRole("button", { name: /later/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("shows downloading state with percent and disables the update button", () => {
    render(
      <UpdateBanner phase="downloading" version="0.2.0" progress={42} onUpdate={() => {}} onDismiss={() => {}} />,
    );
    expect(screen.getByText(/42%/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /updating|downloading/i })).toBeDisabled();
  });

  it("renders nothing for phases other than available/downloading", () => {
    const { container } = render(
      <UpdateBanner phase="idle" version="" progress={0} onUpdate={() => {}} onDismiss={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
