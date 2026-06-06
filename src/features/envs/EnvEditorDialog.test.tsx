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

  it("shows existing variables when editing", () => {
    render(
      <EnvEditorDialog
        open
        originalName="prod"
        activeEnv="prod"
        envs={[{ name: "prod", variables: { host: "api:443" }, color: null }]}
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    );
    expect(screen.getByDisplayValue("host")).toBeInTheDocument();
    expect(screen.getByDisplayValue("api:443")).toBeInTheDocument();
  });

  it("still blocks duplicate names", async () => {
    const user = userEvent.setup();
    render(
      <EnvEditorDialog
        open
        originalName={null}
        activeEnv={null}
        envs={[{ name: "prod", variables: {}, color: null }]}
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    );
    await user.type(screen.getByLabelText("Name"), "prod");
    expect(screen.getByText(/already exists/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create/i })).toBeDisabled();
  });

  it("shows a Delete button in edit mode that calls onRequestDelete", async () => {
    const user = userEvent.setup();
    const onRequestDelete = vi.fn();
    render(
      <EnvEditorDialog
        open
        originalName="prod"
        activeEnv="prod"
        envs={[{ name: "prod", variables: {}, color: null }]}
        onOpenChange={() => {}}
        onSaved={() => {}}
        onRequestDelete={onRequestDelete}
      />,
    );
    await user.click(screen.getByRole("button", { name: /delete/i }));
    expect(onRequestDelete).toHaveBeenCalledWith("prod");
  });

  it("shows no Delete button in create mode", () => {
    render(
      <EnvEditorDialog
        open
        originalName={null}
        activeEnv={null}
        envs={[]}
        onOpenChange={() => {}}
        onSaved={() => {}}
        onRequestDelete={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });

  it("save includes the env color (name-derived default)", async () => {
    const user = userEvent.setup();
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
    await user.type(screen.getByLabelText("Name"), "prod");
    await user.click(screen.getByRole("button", { name: /create/i }));
    const { ipc } = await import("@/ipc/client");
    expect(ipc.envUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ name: "prod", color: "red" }),
    );
  });
});
