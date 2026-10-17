import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { EnvironmentIpc } from "@/ipc/bindings";

vi.mock("@/ipc/client", () => ({
  ipc: {
    envList: vi.fn(),
    envActiveGet: vi.fn(),
    envUpsert: vi.fn(),
    envActiveSet: vi.fn(),
    envDelete: vi.fn(),
    envReorder: vi.fn(),
    varsResolve: vi.fn(),
  },
}));

import { ipc } from "@/ipc/client";
import { messages } from "@/lib/messages";

import { EnvEditorDialog } from "./EnvEditorDialog";
import { resetEnvSyncLane } from "./envSync";
import { resetEnvSaveLanes } from "./useEnvEditor";

const m = messages.envs.editor;

const PAUSE_PLUS_MS = 600;

function clone(envs: readonly EnvironmentIpc[]): EnvironmentIpc[] {
  return envs.map((env) => ({ ...env, variables: { ...env.variables } }));
}

let store: { envs: EnvironmentIpc[]; active: string | null };

function installStore(
  envs: readonly EnvironmentIpc[],
  active: string | null = null,
) {
  store = { envs: clone(envs), active };
  vi.mocked(ipc.envList).mockImplementation(async () => clone(store.envs));
  vi.mocked(ipc.envActiveGet).mockImplementation(async () => store.active);
  vi.mocked(ipc.envUpsert).mockImplementation(async (env) => {
    const at = store.envs.findIndex((e) => e.name === env.name);
    if (at < 0) store.envs.push(clone([env])[0]);
    else store.envs[at] = clone([env])[0];
  });
  vi.mocked(ipc.envActiveSet).mockImplementation(async (name) => {
    if (name !== null && !store.envs.some((e) => e.name === name)) {
      throw { type: "NotFound", message: `unknown environment ${name}` };
    }
    store.active = name;
  });
  vi.mocked(ipc.envDelete).mockImplementation(async (name) => {
    if (name === store.active)
      throw {
        type: "Invalid",
        message: "cannot delete the active environment",
      };
    store.envs = store.envs.filter((e) => e.name !== name);
  });
  vi.mocked(ipc.envReorder).mockImplementation(async (names) => {
    const current = store.envs.map((e) => e.name);
    if (
      names.length !== current.length ||
      !current.every((name) => names.includes(name))
    ) {
      throw { type: "Invalid", message: "reorder needs every environment" };
    }
    store.envs = names.map((name) => store.envs.find((e) => e.name === name)!);
  });
  vi.mocked(ipc.varsResolve).mockImplementation(async (template) => ({
    resolved: template,
    unresolved_vars: [],
    cycle_chain: null,
    dynamic_vars: [],
  }));
}

function renderEditor(subject: string | null) {
  const onStored = vi.fn();
  const onLeave = vi.fn();
  const onOptimistic = vi.fn();
  const onReverted = vi.fn();
  const view = render(
    <EnvEditorDialog
      subject={subject}
      envs={clone(store.envs)}
      onStored={onStored}
      onLeave={onLeave}
      onOptimistic={onOptimistic}
      onReverted={onReverted}
    />,
  );
  return { onStored, onLeave, onOptimistic, onReverted, unmount: view.unmount };
}

function pastThePause() {
  return act(
    () => new Promise((resolve) => setTimeout(resolve, PAUSE_PLUS_MS)),
  );
}

const PROD: EnvironmentIpc = {
  name: "prod",
  color: null,
  variables: { host: "api:443", port: "443" },
};

beforeEach(() => {
  resetEnvSaveLanes();
  resetEnvSyncLane();
  vi.resetAllMocks();
  installStore([PROD], "prod");
});

describe("EnvEditorDialog create mode", () => {
  beforeEach(() => installStore([PROD], "prod"));

  it("focuses the name field on open", () => {
    renderEditor(null);
    expect(screen.getByLabelText(m.nameLabel)).toHaveFocus();
  });

  it("Create with an empty name writes nothing and points at the name", async () => {
    const user = userEvent.setup();
    const { onLeave } = renderEditor(null);
    await user.click(screen.getByRole("button", { name: m.create }));
    expect(screen.getByText(m.nameEmpty)).toBeInTheDocument();
    expect(screen.getByLabelText(m.nameLabel)).toHaveFocus();
    expect(ipc.envUpsert).not.toHaveBeenCalled();
    expect(onLeave).not.toHaveBeenCalled();
  });

  it("keeps edits local until Create, then writes, activates, and closes", async () => {
    const user = userEvent.setup();
    const { onStored, onLeave } = renderEditor(null);
    await user.type(screen.getByLabelText(m.nameLabel), "dev");
    await user.click(screen.getByRole("button", { name: m.addVariable }));
    await user.keyboard("HOST{Enter}api");
    await pastThePause();
    expect(ipc.envUpsert).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: m.create }));
    await waitFor(() =>
      expect(onLeave).toHaveBeenCalledWith({ kind: "closed" }),
    );
    expect(store.envs).toEqual([
      PROD,
      { name: "dev", color: null, variables: { HOST: "api" } },
    ]);
    expect(store.active).toBe("dev");
    expect(onStored).toHaveBeenCalledWith({ activated: "dev" });
  });

  it("writes the color picked from the popover", async () => {
    const user = userEvent.setup();
    const { onLeave } = renderEditor(null);
    await user.type(screen.getByLabelText(m.nameLabel), "stage");
    await user.click(screen.getByRole("button", { name: m.colorAria }));
    await user.click(await screen.findByRole("button", { name: "Blue" }));
    await user.click(screen.getByRole("button", { name: m.create }));
    await waitFor(() => expect(onLeave).toHaveBeenCalled());
    expect(store.envs.find((env) => env.name === "stage")?.color).toBe("blue");
  });

  it("asks before discarding a new environment that has content", async () => {
    const user = userEvent.setup();
    const { onLeave } = renderEditor(null);
    await user.type(screen.getByLabelText(m.nameLabel), "dev");
    await user.click(screen.getByRole("button", { name: m.cancel }));
    const prompt = screen.getByRole("group", { name: m.discardNewTitle });
    await user.click(
      within(prompt).getByRole("button", { name: m.keepEditing }),
    );
    expect(screen.queryByRole("group", { name: m.discardNewTitle })).toBeNull();
    expect(screen.getByLabelText(m.nameLabel)).toHaveValue("dev");

    await user.click(screen.getByRole("button", { name: m.cancel }));
    const again = screen.getByRole("group", { name: m.discardNewTitle });
    await user.click(within(again).getByRole("button", { name: m.discard }));
    expect(onLeave).toHaveBeenCalledWith({ kind: "closed" });
    expect(ipc.envUpsert).not.toHaveBeenCalled();
  });

  it("closes an untouched new environment at once", async () => {
    const user = userEvent.setup();
    const { onLeave } = renderEditor(null);
    await user.keyboard("{Escape}");
    expect(onLeave).toHaveBeenCalledWith({ kind: "closed" });
  });
});

describe("EnvEditorDialog edit mode", () => {
  it("focuses search, shows the stored variables, and has no Save or Cancel", () => {
    renderEditor("prod");
    expect(screen.getByLabelText(m.searchAria)).toHaveFocus();
    expect(screen.getByDisplayValue("host")).toBeInTheDocument();
    expect(screen.getByDisplayValue("api:443")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: m.cancel })).toBeNull();
    expect(screen.getByRole("button", { name: m.done })).toBeInTheDocument();
  });

  it("opens oldest first under VARIABLE and cycles the header through four orders", async () => {
    const user = userEvent.setup();
    installStore(
      [
        {
          name: "prod",
          color: null,
          variables: { zeta: "1", alpha: "2", mango: "3" },
        },
      ],
      "prod",
    );
    renderEditor("prod");
    const header = () => screen.getByRole("columnheader", { name: /Variable/ });
    const keys = () =>
      screen.getAllByPlaceholderText(m.keyPlaceholder).map((el) => (el as HTMLInputElement).value);
    expect(screen.getByPlaceholderText(m.searchPlaceholder)).toBeInTheDocument();
    expect(header()).toHaveAttribute("aria-sort", "ascending");
    expect(header()).toHaveTextContent(m.sort["added-oldest"]);
    expect(keys()).toEqual(["zeta", "alpha", "mango"]);

    await user.click(screen.getByRole("button", { name: /Variable/ }));
    expect(header()).toHaveAttribute("aria-sort", "descending");
    expect(header()).toHaveTextContent(m.sort["added-newest"]);
    expect(keys()).toEqual(["mango", "alpha", "zeta"]);

    await user.click(screen.getByRole("button", { name: /Variable/ }));
    expect(header()).toHaveAttribute("aria-sort", "ascending");
    expect(keys()).toEqual(["alpha", "mango", "zeta"]);

    await user.click(screen.getByRole("button", { name: /Variable/ }));
    expect(header()).toHaveAttribute("aria-sort", "descending");
    expect(keys()).toEqual(["zeta", "mango", "alpha"]);

    await user.click(screen.getByRole("button", { name: /Variable/ }));
    expect(header()).toHaveAttribute("data-sort", "added-oldest");
    expect(keys()).toEqual(["zeta", "alpha", "mango"]);
  });

  it("saves a value edit after the pause and keeps an unpicked color null", async () => {
    const user = userEvent.setup();
    renderEditor("prod");
    await user.type(screen.getByDisplayValue("api:443"), "1");
    expect(screen.getByRole("status")).toHaveTextContent(m.statusSaving);
    await waitFor(
      () =>
        expect(store.envs[0].variables).toEqual({
          host: "api:4431",
          port: "443",
        }),
      {
        timeout: 2000,
      },
    );
    expect(store.envs[0].color).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(m.statusSaved),
    );
  });

  it("saves a renamed key on Enter, not while it is typed", async () => {
    const user = userEvent.setup();
    renderEditor("prod");
    const key = screen.getByDisplayValue("port");
    await user.clear(key);
    await user.type(key, "PORT");
    await pastThePause();
    expect(ipc.envUpsert).not.toHaveBeenCalled();

    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(store.envs[0].variables).toEqual({ host: "api:443", PORT: "443" }),
    );
  });

  it("renaming the active environment keeps its position and follows it", async () => {
    const user = userEvent.setup();
    installStore(
      [
        { name: "a", color: null, variables: {} },
        { name: "b", color: null, variables: { k: "v" } },
        { name: "c", color: null, variables: {} },
      ],
      "b",
    );
    const { onStored } = renderEditor("b");
    const name = screen.getByLabelText(m.nameLabel);
    await user.clear(name);
    await user.type(name, "b2{Enter}");
    await waitFor(() =>
      expect(onStored).toHaveBeenCalledWith({ activated: "b2" }),
    );
    expect(store.envs.map((env) => env.name)).toEqual(["a", "b2", "c"]);
    expect(store.envs[1].variables).toEqual({ k: "v" });
    expect(store.active).toBe("b2");
    expect(
      screen.getByRole("button", { name: m.switchAria }),
    ).toHaveTextContent("b2");
  });

  it("a taken name shows its error, and Done drops that rename and closes", async () => {
    const user = userEvent.setup();
    installStore([PROD, { name: "stage", color: null, variables: {} }], "prod");
    const { onLeave, onOptimistic } = renderEditor("prod");
    const name = screen.getByLabelText(m.nameLabel);
    await user.clear(name);
    await user.type(name, "stage{Enter}");
    expect(name).toHaveAccessibleDescription(m.nameTaken);
    await user.click(screen.getByRole("button", { name: m.done }));
    expect(onLeave).toHaveBeenCalledWith({ kind: "closed" });
    expect(onOptimistic).not.toHaveBeenCalled();
    expect(ipc.envUpsert).not.toHaveBeenCalled();
  });

  it("Done closes with the pending value already handed to the parent", async () => {
    const user = userEvent.setup();
    const { onLeave, onOptimistic } = renderEditor("prod");
    await user.type(screen.getByDisplayValue("api:443"), "1");
    await user.click(screen.getByRole("button", { name: m.done }));
    expect(onLeave).toHaveBeenCalledWith({ kind: "closed" });
    expect(onOptimistic).toHaveBeenCalledWith(
      expect.objectContaining({ variables: { host: "api:4431", port: "443" } }),
      "prod",
    );
    await waitFor(() => expect(store.envs[0].variables.host).toBe("api:4431"));
  });

  it("a failed save keeps the window and the draft, and Retry saves", async () => {
    const user = userEvent.setup();
    vi.mocked(ipc.envUpsert).mockRejectedValueOnce({
      type: "Io",
      message: "disk full",
    });
    const { onLeave } = renderEditor("prod");
    await user.type(screen.getByDisplayValue("api:443"), "1");
    await waitFor(
      () =>
        expect(screen.getByRole("status")).toHaveTextContent(m.statusNotSaved),
      { timeout: 2000 },
    );
    expect(screen.getByText(m.saveFailed)).toHaveAttribute(
      "title",
      "disk full",
    );
    expect(screen.getByDisplayValue("api:4431")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: m.retry }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(m.statusSaved),
    );
    expect(store.envs[0].variables.host).toBe("api:4431");
    expect(onLeave).not.toHaveBeenCalled();
  });

  it("Done after a failed save closes immediately and the retry failure is reported once the window is gone", async () => {
    const user = userEvent.setup();
    vi.mocked(ipc.envUpsert).mockRejectedValue({
      type: "Io",
      message: "disk full",
    });
    const { onLeave, onOptimistic, onReverted, unmount } = renderEditor("prod");
    onLeave.mockImplementation(unmount);
    await user.type(screen.getByDisplayValue("api:443"), "1");
    await waitFor(
      () =>
        expect(screen.getByText(m.saveFailed)).toHaveAttribute(
          "title",
          "disk full",
        ),
      {
        timeout: 2000,
      },
    );

    await user.click(screen.getByRole("button", { name: m.done }));
    expect(onLeave).toHaveBeenCalledWith({ kind: "closed" });
    expect(onOptimistic).toHaveBeenCalledWith(
      expect.objectContaining({ variables: { host: "api:4431", port: "443" } }),
      "prod",
    );
    await waitFor(() => expect(onReverted).toHaveBeenCalled());
  });

  it("Done drops a committed duplicate key and closes without writing it", async () => {
    const user = userEvent.setup();
    const { onLeave, onOptimistic } = renderEditor("prod");
    const port = screen.getByDisplayValue("port");
    await user.clear(port);
    await user.type(port, "host{Enter}");
    expect(screen.getAllByText(m.keyDuplicate)).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: m.done }));
    expect(onLeave).toHaveBeenCalledWith({ kind: "closed" });
    expect(onOptimistic).not.toHaveBeenCalled();
    expect(ipc.envUpsert).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("group", { name: m.leaveInvalidTitle }),
    ).toBeNull();
  });

  it("deleting a variable saves at once and offers Undo", async () => {
    const user = userEvent.setup();
    renderEditor("prod");
    await user.click(
      screen.getByRole("button", { name: m.deleteVariableAria("port") }),
    );
    expect(screen.queryByDisplayValue("port")).toBeNull();
    await waitFor(() =>
      expect(store.envs[0].variables).toEqual({ host: "api:443" }),
    );

    expect(screen.getByText(m.deleted("port"))).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: m.undo }));
    expect(screen.getByDisplayValue("port")).toBeInTheDocument();
    await waitFor(() =>
      expect(store.envs[0].variables).toEqual({ host: "api:443", port: "443" }),
    );
  });

  it("Delete environment hands off to the confirmation dialog", async () => {
    const user = userEvent.setup();
    const { onLeave } = renderEditor("prod");
    const del = screen.getByRole("button", { name: m.deleteEnvironment });
    expect(del).toHaveTextContent(/^Delete$/);
    await user.click(del);
    expect(onLeave).toHaveBeenCalledWith({
      kind: "deleteRequested",
      name: "prod",
    });
    expect(ipc.envDelete).not.toHaveBeenCalled();
  });

  it("shows a circled check beside the muted saved status", () => {
    renderEditor("prod");
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(m.statusSaved);
    expect(status).toHaveClass("text-sm");
    const icon = status.querySelector("svg");
    expect(icon).toHaveClass("lucide-circle-check", "text-ok");
    expect(icon).toHaveAttribute("stroke-width", "1.5");
    expect(status.querySelector("span")).toHaveClass("text-muted-foreground");
    const footer = screen.getByRole("button", {
      name: m.deleteEnvironment,
    }).parentElement!;
    expect(footer.querySelector("span[aria-hidden]")).toHaveClass(
      "h-9",
      "w-px",
      "bg-muted-foreground/40",
    );
  });

  it("Escape closes a saved editor from search, a key, and a value", async () => {
    const user = userEvent.setup();
    const { onLeave } = renderEditor("prod");
    expect(screen.getByLabelText(m.searchAria)).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(onLeave).toHaveBeenCalledWith({ kind: "closed" });

    onLeave.mockClear();
    await user.click(screen.getByDisplayValue("host"));
    expect(screen.getByDisplayValue("host")).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(onLeave).toHaveBeenCalledWith({ kind: "closed" });

    onLeave.mockClear();
    await user.click(screen.getByDisplayValue("api:443"));
    expect(screen.getByDisplayValue("api:443")).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(onLeave).toHaveBeenCalledWith({ kind: "closed" });
    expect(ipc.envUpsert).not.toHaveBeenCalled();
  });

  it("Escape publishes a paused value and closes before the write finishes", async () => {
    const user = userEvent.setup();
    const gate: { go: (() => void) | null } = { go: null };
    vi.mocked(ipc.envUpsert).mockImplementation(
      (env) =>
        new Promise<void>((resolve) => {
          gate.go = () => {
            store.envs[0] = clone([env])[0];
            resolve();
          };
        }),
    );
    const { onLeave, onOptimistic } = renderEditor("prod");
    await user.type(screen.getByDisplayValue("api:443"), "9");
    expect(ipc.envUpsert).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(onLeave).toHaveBeenCalledWith({ kind: "closed" });
    expect(onOptimistic).toHaveBeenCalledWith(
      expect.objectContaining({ variables: { host: "api:4439", port: "443" } }),
      "prod",
    );
    expect(ipc.envUpsert).toHaveBeenCalledTimes(1);
    expect(store.envs[0].variables.host).toBe("api:443");
    gate.go?.();
    await waitFor(() => expect(store.envs[0].variables.host).toBe("api:4439"));
  });

  it("Done publishes a paused value and closes before the write finishes", async () => {
    const user = userEvent.setup();
    vi.mocked(ipc.envUpsert).mockImplementation(() => new Promise(() => {}));
    const { onLeave, onOptimistic } = renderEditor("prod");
    await user.type(screen.getByDisplayValue("api:443"), "9");
    await user.click(screen.getByRole("button", { name: m.done }));
    expect(onLeave).toHaveBeenCalledWith({ kind: "closed" });
    expect(onOptimistic).toHaveBeenCalledWith(
      expect.objectContaining({ variables: { host: "api:4439", port: "443" } }),
      "prod",
    );
    expect(store.envs[0].variables.host).toBe("api:443");
  });

  it("the close button publishes a paused value and closes before the write finishes", async () => {
    const user = userEvent.setup();
    vi.mocked(ipc.envUpsert).mockImplementation(() => new Promise(() => {}));
    const { onLeave, onOptimistic } = renderEditor("prod");
    await user.type(screen.getByDisplayValue("api:443"), "8");
    await user.click(screen.getByRole("button", { name: m.closeAria }));
    expect(onLeave).toHaveBeenCalledWith({ kind: "closed" });
    expect(onOptimistic).toHaveBeenCalledWith(
      expect.objectContaining({ variables: { host: "api:4438", port: "443" } }),
      "prod",
    );
    expect(store.envs[0].variables.host).toBe("api:443");
  });

  it("Escape drops an uncommitted duplicate key and closes", async () => {
    const user = userEvent.setup();
    const { onLeave, onOptimistic } = renderEditor("prod");
    const port = screen.getByDisplayValue("port");
    await user.type(port, "{backspace}{backspace}{backspace}{backspace}host");
    await user.keyboard("{Escape}");
    expect(onLeave).toHaveBeenCalledWith({ kind: "closed" });
    expect(onOptimistic).not.toHaveBeenCalled();
    expect(ipc.envUpsert).not.toHaveBeenCalled();
  });

  it("Escape after a failed write closes and reports the retry failure", async () => {
    const user = userEvent.setup();
    vi.mocked(ipc.envUpsert).mockRejectedValue({
      type: "Io",
      message: "disk full",
    });
    const { onLeave, onReverted, unmount } = renderEditor("prod");
    onLeave.mockImplementation(unmount);
    await user.type(screen.getByDisplayValue("api:443"), "9");
    await waitFor(
      () =>
        expect(screen.getByText(m.saveFailed)).toHaveAttribute(
          "title",
          "disk full",
        ),
      {
        timeout: 2000,
      },
    );

    await user.keyboard("{Escape}");
    expect(onLeave).toHaveBeenCalledWith({ kind: "closed" });
    await waitFor(() => expect(onReverted).toHaveBeenCalled());
  });

  it("Escape from the variable header closes the editor", async () => {
    const user = userEvent.setup();
    const { onLeave } = renderEditor("prod");
    await user.click(screen.getByRole("button", { name: /Variable/ }));
    expect(screen.queryByRole("menu")).toBeNull();
    await user.keyboard("{Escape}");
    expect(onLeave).toHaveBeenCalledWith({ kind: "closed" });
  });

  it("search filters keys, counts matches, and Clear search brings every row back", async () => {
    const user = userEvent.setup();
    renderEditor("prod");
    const search = screen.getByLabelText(m.searchAria);
    await user.type(search, "HO");
    expect(screen.getByText(m.count(1, 2))).toBeInTheDocument();
    expect(screen.getByText("ho", { selector: "mark" })).toHaveClass(
      "bg-info/40",
    );
    expect(screen.getByDisplayValue("host")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("port")).toBeNull();

    await user.type(search, "zz");
    const empty = screen.getByText(m.noMatches).parentElement!;
    await user.click(
      within(empty).getByRole("button", { name: m.clearSearch }),
    );
    expect(search).toHaveValue("");
    expect(search).toHaveFocus();
    expect(screen.getByDisplayValue("port")).toBeInTheDocument();
  });

  it("Ctrl+F moves focus to search", async () => {
    const user = userEvent.setup();
    renderEditor("prod");
    await user.click(screen.getByDisplayValue("host"));
    await user.keyboard("{Control>}f{/Control}");
    expect(screen.getByLabelText(m.searchAria)).toHaveFocus();
    expect(screen.getByDisplayValue("host")).toBeInTheDocument();
  });

  it("resolves a row preview against the editor's variables", async () => {
    installStore(
      [
        {
          name: "prod",
          color: null,
          variables: { url: "{{stage}}.example.com" },
        },
      ],
      "prod",
    );
    renderEditor("prod");
    expect(
      await screen.findByText(/→ resolves:|⚠ Unresolved/),
    ).toBeInTheDocument();
    expect(ipc.varsResolve).toHaveBeenCalledWith(
      "{{stage}}.example.com",
      expect.objectContaining({ env_vars: { url: "{{stage}}.example.com" } }),
    );
  });
});

describe("EnvEditorDialog environment switcher", () => {
  const twoEnvs: EnvironmentIpc[] = [
    { name: "staging", variables: { host: "stg" }, color: null },
    { name: "prod", variables: { host: "prd" }, color: "blue" },
  ];

  beforeEach(() => installStore(twoEnvs, "staging"));

  it("shows the edited environment when it is the only one", () => {
    installStore([PROD], "prod");
    renderEditor("prod");
    expect(
      screen.getByRole("button", { name: m.switchAria }),
    ).toHaveTextContent("prod");
  });

  it("switches to another env without changing the active env", async () => {
    const user = userEvent.setup();
    const { onLeave } = renderEditor("staging");
    const trigger = screen.getByRole("button", { name: m.switchAria });
    expect(trigger).toHaveTextContent("staging");
    await user.click(trigger);
    await user.click(await screen.findByRole("menuitem", { name: "prod" }));
    expect(onLeave).toHaveBeenCalledWith({ kind: "switched", to: "prod" });
    expect(ipc.envActiveSet).not.toHaveBeenCalled();
  });

  it("publishes a pending edit and switches before the write finishes", async () => {
    const user = userEvent.setup();
    const { onLeave, onOptimistic } = renderEditor("staging");
    await user.type(screen.getByDisplayValue("stg"), "2");
    // The menu takes focus while React commits. A typed field blurred there makes user-event
    // fire `change` in a nested act(), which React then reports as unwrapped updates.
    await user.tab();
    await user.click(screen.getByRole("button", { name: m.switchAria }));
    await user.click(await screen.findByRole("menuitem", { name: "prod" }));
    expect(onLeave).toHaveBeenCalledWith({ kind: "switched", to: "prod" });
    expect(onOptimistic).toHaveBeenCalledWith(
      expect.objectContaining({ variables: { host: "stg2" } }),
      "staging",
    );
    await waitFor(() =>
      expect(store.envs[0].variables).toEqual({ host: "stg2" }),
    );
  });

  it("closes the menu on Escape, then the editor on the next Escape", async () => {
    const user = userEvent.setup();
    const { onLeave } = renderEditor("staging");
    await user.click(screen.getByRole("button", { name: m.switchAria }));
    expect(
      await screen.findByRole("menuitem", { name: "prod" }),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menuitem", { name: "prod" })).toBeNull();
    expect(onLeave).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(onLeave).toHaveBeenCalledWith({ kind: "closed" });
  });
});
