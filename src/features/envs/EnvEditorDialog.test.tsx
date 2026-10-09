import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/ipc/client", () => ({
  ipc: {
    envUpsert: vi.fn(),
    envActiveSet: vi.fn(),
    envDelete: vi.fn(),
    envReorder: vi.fn(),
    varsResolve: vi.fn(async (t: string) => ({ resolved: t, unresolved_vars: [], cycle_chain: null, dynamic_vars: [] })),
  },
}));

import { EnvEditorDialog } from "./EnvEditorDialog";
import { ipc } from "@/ipc/client";
import { messages } from "@/lib/messages";

const m = messages.envs.editor;

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

  it("resolves a row preview against the edited (unsaved) rows", async () => {
    render(
      <EnvEditorDialog
        open
        originalName="prod"
        activeEnv="prod"
        envs={[{ name: "prod", variables: { url: "{{stage}}.example.com" }, color: null }]}
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    );
    expect(await screen.findByText(/→ resolves:|⚠ Unresolved/)).toBeInTheDocument();
    expect(ipc.varsResolve).toHaveBeenCalledWith(
      expect.stringContaining("{{"),
      expect.objectContaining({ env_vars: expect.any(Object) }),
    );
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
    expect(ipc.envUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ name: "prod", color: "red" }),
    );
  });

  it("saves the color picked from the popover", async () => {
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
    await user.type(screen.getByLabelText("Name"), "prod"); // name default = red
    await user.click(screen.getByRole("button", { name: "Environment color" }));
    await user.click(await screen.findByRole("button", { name: "Blue" }));
    await user.click(screen.getByRole("button", { name: /create/i }));
    expect(ipc.envUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ name: "prod", color: "blue" }),
    );
  });

  it("dialog content is height-capped and column-flex (scales + internal scroll)", () => {
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
    const content = document.querySelector('[data-slot="dialog-content"]')!;
    expect(content.className).toContain("max-h-[85vh]");
    expect(content.className).toContain("flex-col");
  });

  it("the variables region scrolls internally", () => {
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
    const region = screen.getByText("Variables").closest("div")!;
    expect(region.className).toContain("overflow-auto");
  });
});

describe("EnvEditorDialog rename order preservation", () => {
  const threeEnvs = [
    { name: "a", variables: {}, color: null },
    { name: "b", variables: {}, color: null },
    { name: "c", variables: {}, color: null },
  ];

  beforeEach(() => {
    vi.mocked(ipc.envUpsert).mockClear();
    vi.mocked(ipc.envActiveSet).mockClear();
    vi.mocked(ipc.envDelete).mockClear();
    vi.mocked(ipc.envReorder).mockClear();
  });

  it("rename restores the env's position via envReorder", async () => {
    const user = userEvent.setup();
    render(
      <EnvEditorDialog
        open
        originalName="b"
        activeEnv={null}
        envs={threeEnvs}
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    );
    const nameInput = screen.getByLabelText("Name");
    await user.clear(nameInput);
    await user.type(nameInput, "b2");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(ipc.envDelete).toHaveBeenCalledWith("b");
    expect(ipc.envReorder).toHaveBeenCalledWith(["a", "b2", "c"]);
  });

  it("a non-rename save does not call envReorder", async () => {
    const user = userEvent.setup();
    render(
      <EnvEditorDialog
        open
        originalName="b"
        activeEnv={null}
        envs={threeEnvs}
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(ipc.envReorder).not.toHaveBeenCalled();
  });
});

describe("EnvEditorDialog environment switcher", () => {
  const twoEnvs = [
    { name: "staging", variables: { host: "stg" }, color: null },
    { name: "prod", variables: { host: "prd" }, color: "blue" },
  ];

  it("does not close a switched editor when the save it left behind finishes", async () => {
    const user = userEvent.setup();
    let finishSave: (() => void) | undefined;
    vi.mocked(ipc.envUpsert).mockImplementationOnce(
      () => new Promise((resolve) => {
        finishSave = () => resolve(undefined);
      }),
    );
    const onOpenChange = vi.fn();
    const { unmount } = render(
      <EnvEditorDialog
        open
        originalName="staging"
        activeEnv="staging"
        envs={twoEnvs}
        onOpenChange={onOpenChange}
        onSaved={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    unmount();
    finishSave?.();
    await act(async () => {});
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("closes the menu on Escape without closing the editor", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <EnvEditorDialog
        open
        originalName="staging"
        activeEnv="staging"
        envs={twoEnvs}
        onOpenChange={onOpenChange}
        onSaved={() => {}}
        onSwitch={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: m.switchAria }));
    expect(screen.getByRole("menuitem", { name: "prod" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menuitem", { name: "prod" })).not.toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("hides the switcher when there is no other env", () => {
    render(
      <EnvEditorDialog
        open
        originalName="prod"
        activeEnv="prod"
        envs={[{ name: "prod", variables: {}, color: null }]}
        onOpenChange={() => {}}
        onSaved={() => {}}
        onSwitch={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: m.switchAria })).not.toBeInTheDocument();
  });

  it("switches to another env without changing the active env", async () => {
    const user = userEvent.setup();
    const onSwitch = vi.fn();
    render(
      <EnvEditorDialog
        open
        originalName="staging"
        activeEnv="staging"
        envs={twoEnvs}
        onOpenChange={() => {}}
        onSaved={() => {}}
        onSwitch={onSwitch}
      />,
    );
    const trigger = screen.getByRole("button", { name: m.switchAria });
    expect(trigger).toHaveTextContent("staging");
    await user.click(trigger);
    await user.click(await screen.findByRole("menuitem", { name: "prod" }));
    expect(onSwitch).toHaveBeenCalledWith("prod");
    expect(ipc.envActiveSet).not.toHaveBeenCalled();
  });

  it("asks before discarding unsaved edits, and cancel keeps the current env", async () => {
    const user = userEvent.setup();
    const onSwitch = vi.fn();
    render(
      <EnvEditorDialog
        open
        originalName="staging"
        activeEnv="staging"
        envs={twoEnvs}
        onOpenChange={() => {}}
        onSaved={() => {}}
        onSwitch={onSwitch}
      />,
    );
    const nameInput = screen.getByLabelText(m.nameAria);
    await user.clear(nameInput);
    await user.type(nameInput, "staging-2");
    await user.click(screen.getByRole("button", { name: m.switchAria }));
    await user.click(await screen.findByRole("menuitem", { name: "prod" }));
    const confirm = screen.getByRole("group", { name: m.discardTitle });
    expect(within(confirm).getByText(m.discardDescription)).toBeInTheDocument();
    await user.click(within(confirm).getByRole("button", { name: m.cancel }));
    expect(onSwitch).not.toHaveBeenCalled();
    expect(screen.getByLabelText(m.nameAria)).toHaveValue("staging-2");
  });

  it("discards unsaved edits and switches when confirmed", async () => {
    const user = userEvent.setup();
    const onSwitch = vi.fn();
    render(
      <EnvEditorDialog
        open
        originalName="staging"
        activeEnv="staging"
        envs={twoEnvs}
        onOpenChange={() => {}}
        onSaved={() => {}}
        onSwitch={onSwitch}
      />,
    );
    await user.type(screen.getByLabelText(m.nameAria), "-x");
    await user.click(screen.getByRole("button", { name: m.switchAria }));
    await user.click(await screen.findByRole("menuitem", { name: "prod" }));
    await user.click(screen.getByRole("button", { name: m.discard }));
    expect(onSwitch).toHaveBeenCalledWith("prod");
    expect(ipc.envActiveSet).not.toHaveBeenCalled();
  });
});
