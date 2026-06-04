import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/ipc/client", () => ({
  ipc: { envUpsert: vi.fn(), envActiveSet: vi.fn(), envDelete: vi.fn() },
}));

import { EnvEditorDialog } from "./EnvEditorDialog";

function renderDialog() {
  render(
    <EnvEditorDialog
      open
      originalName={null}
      activeEnv={null}
      envs={[]}
      onOpenChange={() => {}}
      onSaved={() => {}}
    />,
  );
}

describe("EnvEditorDialog name validation", () => {
  it("accepts any non-empty name (no charset restriction)", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByLabelText("Name"), "prod eu.1");
    expect(screen.queryByText(/name must match/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create/i })).toBeEnabled();
  });

  it("still blocks empty names", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: /create/i })).toBeDisabled();
  });

  it("still blocks duplicate names", async () => {
    const user = userEvent.setup();
    render(
      <EnvEditorDialog
        open
        originalName={null}
        activeEnv={null}
        envs={[{ name: "prod", variables: {} }]}
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    );
    await user.type(screen.getByLabelText("Name"), "prod");
    expect(screen.getByText(/already exists/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create/i })).toBeDisabled();
  });
});
