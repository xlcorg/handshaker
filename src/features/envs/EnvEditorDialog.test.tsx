import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

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
import {
  ENV_AUTOSAVE_DELAY_MS,
  resetEnvSaveLanes,
  revealDelta,
} from "./useEnvEditor";

const m = messages.envs.editor;

function clone(envs: readonly EnvironmentIpc[]): EnvironmentIpc[] {
  return envs.map((env) => ({ ...env, variables: { ...env.variables } }));
}

let store: { envs: EnvironmentIpc[]; active: string | null };

function write(env: EnvironmentIpc): void {
  const at = store.envs.findIndex((e) => e.name === env.name);
  if (at < 0) store.envs.push(clone([env])[0]);
  else store.envs[at] = clone([env])[0];
}

function installStore(
  envs: readonly EnvironmentIpc[],
  active: string | null = null,
) {
  store = { envs: clone(envs), active };
  vi.mocked(ipc.envList).mockImplementation(async () => clone(store.envs));
  vi.mocked(ipc.envActiveGet).mockImplementation(async () => store.active);
  vi.mocked(ipc.envUpsert).mockImplementation(async (env) => write(env));
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
    store.envs = names.map((name) => store.envs.find((e) => e.name === name)!);
  });
  vi.mocked(ipc.varsResolve).mockImplementation(async (template) => ({
    resolved: template,
    unresolved_vars: [],
    cycle_chain: null,
    dynamic_vars: [],
  }));
}

interface Pending {
  readonly env: EnvironmentIpc;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
}

function gateUpsert(): Pending[] {
  const pending: Pending[] = [];
  vi.mocked(ipc.envUpsert).mockImplementation(
    (env) =>
      new Promise<void>((resolve, reject) => {
        pending.push({
          env,
          resolve: () => {
            write(env);
            resolve();
          },
          reject,
        });
      }),
  );
  return pending;
}

function renderEditor(opened: string | null) {
  const spies = {
    onStored: vi.fn(),
    onDeleted: vi.fn(),
    onClosed: vi.fn(),
    onOptimistic: vi.fn(),
    onReverted: vi.fn(),
  };
  function Harness() {
    const [envs, setEnvs] = useState(() => clone(store.envs));
    const [open, setOpen] = useState(true);
    if (!open) return null;
    return (
      <EnvEditorDialog
        open
        epoch={1}
        opened={opened}
        envs={envs}
        onStored={(event) => {
          spies.onStored(event);
          setEnvs(clone(store.envs));
        }}
        onDeleted={(event) => {
          spies.onDeleted(event);
          setEnvs(clone(store.envs));
        }}
        onClosed={() => {
          spies.onClosed();
          setOpen(false);
        }}
        onOptimistic={(env, previousName) => {
          spies.onOptimistic(env, previousName);
          setEnvs((prev) => replaceEnv(prev, previousName, env));
        }}
        onReverted={(currentName, env) => {
          spies.onReverted(currentName, env);
          setEnvs((prev) => replaceEnv(prev, currentName, env));
        }}
      />
    );
  }
  render(<Harness />);
  return spies;
}

function keys(): string[] {
  return within(screen.getByRole("table"))
    .getAllByRole("row")
    .slice(1)
    .flatMap((row) => {
      const el = row.querySelector<HTMLElement>('[data-field^="key:"]');
      if (!el) return [];
      return [
        el instanceof HTMLInputElement ? el.value : (el.textContent ?? ""),
      ];
    });
}

function envRow(name: string): HTMLElement {
  return within(
    screen.getByRole("navigation", { name: m.listLabel }),
  ).getByRole("button", { name });
}

function replaceEnv(
  envs: readonly EnvironmentIpc[],
  name: string,
  env: EnvironmentIpc,
): EnvironmentIpc[] {
  const at = envs.findIndex((item) => item.name === name);
  if (at < 0) return [...envs, env];
  const next = envs.slice();
  next[at] = env;
  return next;
}

function dotOf(row: HTMLElement): string {
  return (
    row.querySelector<HTMLElement>("span[aria-hidden]")?.style
      .backgroundColor ?? ""
  );
}

function statusText(): string {
  return screen.getByRole("status").textContent ?? "";
}

function watchStatus(): string[] {
  const seen: string[] = [];
  const status = screen.getByRole("status");
  new MutationObserver(() => seen.push(status.textContent ?? "")).observe(
    status,
    {
      subtree: true,
      childList: true,
      characterData: true,
    },
  );
  return seen;
}

async function editValue(
  user: ReturnType<typeof userEvent.setup>,
  from: string,
  typed: string,
) {
  await user.click(screen.getByRole("button", { name: from }));
  await user.keyboard(typed);
}

function pressedSwatches(): string[] {
  return within(screen.getByRole("group", { name: m.colorAria }))
    .getAllByRole("button")
    .filter((b) => b.getAttribute("aria-pressed") === "true")
    .map((b) => b.getAttribute("aria-label") ?? "");
}

const PROD: EnvironmentIpc = {
  name: "prod",
  color: null,
  variables: { host: "api:443", port: "443" },
};
const STAGE: EnvironmentIpc = {
  name: "stage",
  color: "teal",
  variables: { host: "stage:443" },
};
const DISK_FULL = { type: "Io", message: "disk full" };

beforeEach(() => {
  resetEnvSaveLanes();
  resetEnvSyncLane();
  vi.resetAllMocks();
  installStore([PROD], "prod");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("sorting", () => {
  const SCRAMBLED: EnvironmentIpc = {
    name: "prod",
    color: null,
    variables: { port: "1", auth: "2", host: "3" },
  };

  it("starts in stored order, and the VARIABLE header flips name sort", async () => {
    installStore([SCRAMBLED]);
    const user = userEvent.setup();
    renderEditor("prod");
    const header = screen.getByRole("columnheader", { name: m.variableHeader });
    expect(keys()).toEqual(["port", "auth", "host"]);
    expect(header).toHaveAttribute("aria-sort", "none");

    await user.click(within(header).getByRole("button"));
    expect(keys()).toEqual(["auth", "host", "port"]);
    expect(header).toHaveAttribute("aria-sort", "ascending");

    await user.click(within(header).getByRole("button"));
    expect(keys()).toEqual(["port", "host", "auth"]);
    expect(header).toHaveAttribute("aria-sort", "descending");
  });

  it("the dropdown's Oldest first clears the arrow and sets aria-sort none", async () => {
    installStore([SCRAMBLED]);
    const user = userEvent.setup();
    renderEditor("prod");
    const header = screen.getByRole("columnheader", { name: m.variableHeader });
    await user.click(within(header).getByRole("button"));
    await user.click(
      screen.getByRole("button", { name: m.sortTrigger(m.sort["name-asc"]) }),
    );
    await user.click(
      await screen.findByRole("menuitemradio", { name: m.sort.oldest }),
    );
    expect(keys()).toEqual(["port", "auth", "host"]);
    expect(header).toHaveAttribute("aria-sort", "none");
    expect(header.querySelector("svg")).toBeNull();
    expect(
      screen.getByRole("button", { name: m.sortTrigger(m.sort.oldest) }),
    ).toBeInTheDocument();
  });

  it("switching environments keeps the sort and clears the search", async () => {
    installStore([PROD, STAGE]);
    const user = userEvent.setup();
    renderEditor("prod");
    await user.click(screen.getByRole("button", { name: m.variableHeader }));
    await user.type(screen.getByLabelText(m.searchAria), "ho");
    await user.click(envRow("stage"));
    expect(envRow("stage")).toHaveAttribute("aria-current", "true");
    expect(
      screen.getByRole("columnheader", { name: m.variableHeader }),
    ).toHaveAttribute("aria-sort", "ascending");
    expect(screen.getByLabelText(m.searchAria)).toHaveValue("");
    expect(keys()).toEqual(["host"]);
  });
});

describe("list selection", () => {
  it("shows another environment without changing the active one", async () => {
    installStore([PROD, STAGE], "prod");
    const user = userEvent.setup();
    renderEditor("prod");
    expect(envRow("prod")).toHaveAttribute("aria-current", "true");
    await user.click(envRow("stage"));
    expect(envRow("stage")).toHaveAttribute("aria-current", "true");
    expect(envRow("stage")).toHaveFocus();
    expect(
      screen.getByRole("button", { name: "stage:443" }),
    ).toBeInTheDocument();
    expect(ipc.envActiveSet).not.toHaveBeenCalled();
    expect(store.active).toBe("prod");
  });
});

describe("revealDelta", () => {
  it("scrolls enough to clear the row and the scroller padding", () => {
    expect(revealDelta(780, 770, 8)).toBe(18);
    expect(revealDelta(700, 770, 8)).toBe(0);
  });
});

describe("add variable row", () => {
  it("opens last under a name sort, focused, and an empty commit writes nothing", async () => {
    installStore([
      { name: "prod", color: null, variables: { b: "2", a: "1" } },
    ]);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderEditor("prod");
    await user.click(screen.getByRole("button", { name: m.variableHeader }));
    await user.click(screen.getByRole("button", { name: m.addVariable }));
    expect(screen.getByPlaceholderText(m.keyPlaceholder)).toHaveFocus();
    expect(keys()).toEqual(["a", "b", ""]);

    await user.keyboard("{Enter}");
    await act(async () => {
      vi.advanceTimersByTime(ENV_AUTOSAVE_DELAY_MS * 2);
    });
    expect(keys()).toEqual(["a", "b"]);
    expect(ipc.envUpsert).not.toHaveBeenCalled();
  });

  it("commits a keyed row once with Enter, and Escape cancels a draft without closing", async () => {
    const user = userEvent.setup();
    const spies = renderEditor("prod");
    await user.click(screen.getByRole("button", { name: m.addVariable }));
    await user.keyboard("token{Tab}abc{Enter}");
    await waitFor(() => expect(ipc.envUpsert).toHaveBeenCalledTimes(1));
    expect(vi.mocked(ipc.envUpsert).mock.calls[0][0].variables).toEqual({
      host: "api:443",
      port: "443",
      token: "abc",
    });

    await user.click(screen.getByRole("button", { name: m.addVariable }));
    await user.keyboard("draft{Escape}");
    expect(screen.queryByPlaceholderText(m.keyPlaceholder)).toBeNull();
    expect(spies.onClosed).not.toHaveBeenCalled();
    expect(ipc.envUpsert).toHaveBeenCalledTimes(1);
  });
});

describe("search and empty bodies", () => {
  it("filters keys, counts matches, and tells no matches from an empty environment", async () => {
    installStore([
      {
        name: "prod",
        color: null,
        variables: {
          CONNECT_TIMEOUT_MS: "5000",
          API_URL: "x",
          READ_TIMEOUT_MS: "30000",
          TIMEOUT_MS: "30000",
        },
      },
      { name: "empty", color: null, variables: {} },
    ]);
    const user = userEvent.setup();
    renderEditor("prod");
    const search = screen.getByLabelText(m.searchAria);
    expect(search).toHaveFocus();
    await user.type(search, "timeout");
    expect(keys()).toEqual([
      "CONNECT_TIMEOUT_MS",
      "READ_TIMEOUT_MS",
      "TIMEOUT_MS",
    ]);
    expect(screen.getByText(m.filterCount(3, 4))).toBeInTheDocument();
    expect(screen.getByText(m.variableCount(4))).toBeInTheDocument();

    await user.type(search, "zz");
    const body = screen.getByText(m.noMatches).parentElement!;
    expect(within(body).getByText(m.noMatchesHint)).toBeInTheDocument();
    expect(screen.queryByText(m.emptyEnvTitle)).toBeNull();
    await user.click(within(body).getByRole("button", { name: m.clearSearch }));
    expect(search).toHaveValue("");
    expect(search).toHaveFocus();
    expect(keys()).toHaveLength(4);

    await user.click(envRow("empty"));
    expect(screen.getByText(m.emptyEnvTitle)).toBeInTheDocument();
    expect(screen.getByText(m.emptyEnvHint)).toBeInTheDocument();
    expect(screen.getByText(m.variableCount(0))).toBeInTheDocument();
    expect(screen.queryByText(m.noMatches)).toBeNull();
  });

  it("Cmd/Ctrl+F focuses search from inside the table", async () => {
    const user = userEvent.setup();
    renderEditor("prod");
    await user.click(screen.getByRole("button", { name: "host" }));
    await user.keyboard(
      navigator.userAgent.includes("Mac")
        ? "{Meta>}f{/Meta}"
        : "{Control>}f{/Control}",
    );
    expect(screen.getByLabelText(m.searchAria)).toHaveFocus();
  });
});

describe("cells", () => {
  it("does not send a value per keystroke, and Enter sends it once", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderEditor("prod");
    await editValue(user, "api:443", "999");
    await act(async () => {
      vi.advanceTimersByTime(ENV_AUTOSAVE_DELAY_MS * 2);
    });
    expect(ipc.envUpsert).not.toHaveBeenCalled();

    await user.keyboard("{Enter}");
    await waitFor(() => expect(ipc.envUpsert).toHaveBeenCalledTimes(1));
    expect(vi.mocked(ipc.envUpsert).mock.calls[0][0].variables).toEqual({
      host: "api:443999",
      port: "443",
    });
    await act(async () => {
      vi.advanceTimersByTime(ENV_AUTOSAVE_DELAY_MS * 2);
    });
    expect(ipc.envUpsert).toHaveBeenCalledTimes(1);
  });

  it("Escape in an open cell cancels it and keeps the dialog; Escape with no open cell closes", async () => {
    const user = userEvent.setup();
    const spies = renderEditor("prod");
    await editValue(user, "api:443", "9");
    expect(screen.getByRole("textbox", { name: m.valueHeader })).toHaveValue(
      "api:4439",
    );

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("textbox", { name: m.valueHeader })).toBeNull();
    expect(screen.getByRole("button", { name: "api:443" })).toHaveFocus();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(spies.onClosed).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(spies.onClosed).toHaveBeenCalledTimes(1);
    expect(ipc.envUpsert).not.toHaveBeenCalled();
  });

  it("deleting a variable offers Undo, which writes it back", async () => {
    const user = userEvent.setup();
    renderEditor("prod");
    await user.click(
      screen.getByRole("button", { name: m.deleteVariableAria("port") }),
    );
    await waitFor(() =>
      expect(store.envs[0].variables).toEqual({ host: "api:443" }),
    );
    const toast = screen.getByRole("group", { name: m.deleted("port") });
    expect(toast).not.toHaveTextContent("443");
    await user.click(within(toast).getByRole("button", { name: m.undo }));
    expect(keys()).toEqual(["host", "port"]);
    await waitFor(() =>
      expect(store.envs[0].variables).toEqual({ host: "api:443", port: "443" }),
    );
  });

  it("the Undo toast lasts 8s and pauses while the pointer is on it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderEditor("prod");
    await user.click(
      screen.getByRole("button", { name: m.deleteVariableAria("port") }),
    );
    const name = { name: m.deleted("port") };
    await act(async () => {
      vi.advanceTimersByTime(6000);
    });
    await user.hover(screen.getByRole("group", name));
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByRole("group", name)).toBeInTheDocument();
    await user.hover(screen.getByRole("table"));
    await act(async () => {
      vi.advanceTimersByTime(2500);
    });
    expect(screen.queryByRole("group", name)).toBeNull();
  });
});

describe("save status", () => {
  it("sits after the variable count, with close last in the header", () => {
    renderEditor("prod");
    const count = screen.getByText(m.variableCount(2));
    const status = screen.getByRole("status");
    const close = screen.getByRole("button", { name: m.closeAria });
    expect(count.compareDocumentPosition(status)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(status.compareDocumentPosition(close)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("is absent on open, shows Saved after a fast ack without Saving, and hides it 2s later", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderEditor("prod");
    expect(statusText()).toBe("");
    const seen = watchStatus();
    await editValue(user, "api:443", "9{Enter}");
    await waitFor(() => expect(statusText()).toBe(m.statusSaved));
    expect(seen).not.toContain(m.statusSaving);
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(statusText()).toBe("");
  });

  it("shows Saving once a write has been owed for 400ms", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const pending = gateUpsert();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderEditor("prod");
    await editValue(user, "api:443", "9{Enter}");
    await waitFor(() => expect(pending).toHaveLength(1));
    expect(statusText()).toBe("");
    await act(async () => {
      vi.advanceTimersByTime(450);
    });
    expect(statusText()).toBe(m.statusSaving);
    await act(async () => pending[0].resolve());
    await waitFor(() => expect(statusText()).toBe(m.statusSaved));
  });

  it("a failed save shows Not saved, keeps the edit, and Retry sends it again", async () => {
    vi.mocked(ipc.envUpsert).mockRejectedValueOnce(DISK_FULL);
    const user = userEvent.setup();
    renderEditor("prod");
    await editValue(user, "api:443", "9{Enter}");
    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent(m.saveFailedKept);
    expect(banner).toHaveAttribute("title", "disk full");
    expect(statusText()).toBe(m.statusNotSaved);
    const status = screen.getByRole("status");
    const retry = screen.getByRole("button", { name: m.retry });
    expect(status.compareDocumentPosition(retry)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(
      retry.compareDocumentPosition(
        screen.getByRole("button", { name: m.closeAria }),
      ),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(
      screen.getByRole("button", { name: "api:4439" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: m.retry }));
    await waitFor(() => expect(statusText()).toBe(m.statusSaved));
    expect(ipc.envUpsert).toHaveBeenCalledTimes(2);
    expect(store.envs[0].variables.host).toBe("api:4439");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a late failure for the environment left behind leaves the visible status alone and marks its row", async () => {
    installStore([PROD, STAGE]);
    const pending = gateUpsert();
    const user = userEvent.setup();
    renderEditor("prod");
    await editValue(user, "api:443", "9{Enter}");
    await waitFor(() => expect(pending).toHaveLength(1));
    await user.click(envRow("stage"));
    expect(statusText()).toBe("");

    await act(async () => pending[0].reject(DISK_FULL));
    expect(statusText()).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(envRow(`prod ${m.notSavedMark}`)).toBeInTheDocument();
  });

  it("a failed save rolls back only the environment that failed", async () => {
    installStore([
      { name: "prod", color: null, variables: { host: "api:443" } },
      { name: "stage", color: "teal", variables: { host: "stage:443" } },
      { name: "other", color: "gray", variables: {} },
    ]);
    const pending = gateUpsert();
    const user = userEvent.setup();
    renderEditor("prod");
    await user.click(screen.getByRole("button", { name: m.colorAria }));
    await user.click(
      screen.getByRole("button", { name: messages.envs.colors.coral }),
    );
    await waitFor(() => expect(pending).toHaveLength(1));
    await user.click(envRow("stage"));
    await user.click(screen.getByRole("button", { name: m.colorAria }));
    await user.click(
      screen.getByRole("button", { name: messages.envs.colors.brown }),
    );
    await user.click(envRow("other"));
    expect(dotOf(envRow("stage"))).toBe("rgb(155, 107, 81)");

    await act(async () => pending[0].reject(DISK_FULL));
    expect(dotOf(envRow("stage"))).toBe("rgb(155, 107, 81)");
    expect(dotOf(envRow(`prod ${m.notSavedMark}`))).toBe("rgb(239, 68, 68)");
  });
});

describe("closing", () => {
  it("publishes an unsent edit, closes at once, and reverts when the write fails", async () => {
    const pending = gateUpsert();
    const user = userEvent.setup();
    const spies = renderEditor("prod");
    await editValue(user, "api:443", "9");
    await user.click(screen.getByRole("button", { name: m.done }));
    expect(spies.onOptimistic).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "prod",
        variables: { host: "api:4439", port: "443" },
      }),
      "prod",
    );
    expect(spies.onClosed).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(pending).toHaveLength(1));
    expect(spies.onReverted).not.toHaveBeenCalled();

    await act(async () => pending[0].reject(DISK_FULL));
    expect(spies.onReverted).toHaveBeenCalledTimes(1);
    expect(pending).toHaveLength(1);
  });

  it("closes a stored environment with a failed save without asking", async () => {
    vi.mocked(ipc.envUpsert).mockRejectedValue(DISK_FULL);
    const user = userEvent.setup();
    const spies = renderEditor("prod");
    await editValue(user, "api:443", "9{Enter}");
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: m.done }));
    expect(spies.onClosed).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("group", { name: m.discardNewTitle })).toBeNull();
    await waitFor(() => expect(spies.onReverted).toHaveBeenCalledTimes(1));
  });
});

describe("deleting an environment", () => {
  it("focuses Cancel, waits for the queue, then clears the active env and selects the neighbor", async () => {
    installStore([PROD, STAGE], "prod");
    const pending = gateUpsert();
    const user = userEvent.setup();
    const spies = renderEditor("prod");
    await editValue(user, "api:443", "9{Enter}");
    await waitFor(() => expect(pending).toHaveLength(1));

    await user.click(
      screen.getByRole("button", { name: m.deleteEnvironmentAria }),
    );
    const confirm = await screen.findByRole("alertdialog");
    expect(
      within(confirm).getByRole("heading", {
        name: m.confirmDeleteTitle("prod"),
      }),
    ).toBeInTheDocument();
    expect(
      within(confirm).getByText(m.confirmDeleteBody(2)),
    ).toBeInTheDocument();
    expect(
      within(confirm).getByRole("button", { name: m.cancel }),
    ).toHaveFocus();
    const action = within(confirm).getByRole("button", {
      name: m.confirmDeleteAction,
    });
    expect(action).toBeDisabled();

    await act(async () => pending[0].resolve());
    await waitFor(() => expect(action).toBeEnabled());
    expect(ipc.envDelete).not.toHaveBeenCalled();
    await user.click(action);

    await waitFor(() =>
      expect(spies.onDeleted).toHaveBeenCalledWith({ name: "prod" }),
    );
    const order = (fn: unknown) =>
      vi.mocked(fn as () => unknown).mock.invocationCallOrder[0];
    expect(order(ipc.envUpsert)).toBeLessThan(order(ipc.envActiveSet));
    expect(order(ipc.envActiveSet)).toBeLessThan(order(ipc.envDelete));
    expect(ipc.envActiveSet).toHaveBeenCalledWith(null);
    expect(store.envs.map((env) => env.name)).toEqual(["stage"]);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(envRow("stage")).toHaveAttribute("aria-current", "true");
    expect(spies.onClosed).not.toHaveBeenCalled();
  });

  it("keeps the confirm open with the error when the delete fails", async () => {
    installStore([PROD, STAGE]);
    vi.mocked(ipc.envDelete).mockRejectedValue(DISK_FULL);
    const user = userEvent.setup();
    renderEditor("prod");
    await user.click(
      screen.getByRole("button", { name: m.deleteEnvironmentAria }),
    );
    const confirm = await screen.findByRole("alertdialog");
    await user.click(
      within(confirm).getByRole("button", { name: m.confirmDeleteAction }),
    );
    expect(await within(confirm).findByRole("alert")).toHaveTextContent(
      m.deleteFailed,
    );
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    await user.click(within(confirm).getByRole("button", { name: m.cancel }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(envRow("prod")).toHaveAttribute("aria-current", "true");
  });

  it("deleting the last environment leaves the editor open on an empty list", async () => {
    installStore([PROD]);
    const user = userEvent.setup();
    const spies = renderEditor("prod");
    await user.click(
      screen.getByRole("button", { name: m.deleteEnvironmentAria }),
    );
    const confirm = await screen.findByRole("alertdialog");
    await user.click(
      within(confirm).getByRole("button", { name: m.confirmDeleteAction }),
    );

    expect(await screen.findByText(m.noEnvironments)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: m.newEnvironmentAria }),
    ).toHaveFocus();
    expect(spies.onClosed).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: m.addEnvironment }));
    expect(screen.getByLabelText(m.nameLabel)).toHaveFocus();
  });
});

describe("colors", () => {
  it("keeps a stored color that is not a preset, and rings no preset", async () => {
    installStore([{ name: "dev", color: "#123456", variables: { a: "1" } }]);
    const user = userEvent.setup();
    renderEditor("dev");
    expect(dotOf(envRow("dev"))).toBe("rgb(18, 52, 86)");
    await user.click(screen.getByRole("button", { name: m.colorAria }));
    expect(pressedSwatches()).toEqual([]);
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await editValue(user, "1", "2{Enter}");
    await waitFor(() => expect(ipc.envUpsert).toHaveBeenCalledTimes(1));
    expect(vi.mocked(ipc.envUpsert).mock.calls[0][0].color).toBe("#123456");
  });

  it("derives a null color through the old ten keys", async () => {
    installStore([
      { name: "prod", color: null, variables: {} },
      { name: "local", color: null, variables: {} },
    ]);
    const user = userEvent.setup();
    renderEditor("prod");
    expect(dotOf(envRow("prod"))).toBe("rgb(239, 68, 68)");
    expect(dotOf(envRow("local"))).toBe("rgb(34, 197, 94)");
    await user.click(screen.getByRole("button", { name: m.colorAria }));
    expect(pressedSwatches()).toEqual([]);
    await user.keyboard("{Escape}");

    await user.click(envRow("local"));
    await user.click(screen.getByRole("button", { name: m.colorAria }));
    expect(pressedSwatches()).toEqual([messages.envs.colors.green]);
    expect(ipc.envUpsert).not.toHaveBeenCalled();
  });

  it("picking a preset writes its key and closes the palette", async () => {
    const user = userEvent.setup();
    renderEditor("prod");
    await user.click(screen.getByRole("button", { name: m.colorAria }));
    await user.click(
      screen.getByRole("button", { name: messages.envs.colors.teal }),
    );
    expect(screen.queryByRole("group", { name: m.colorAria })).toBeNull();
    await waitFor(() => expect(store.envs[0].color).toBe("teal"));
    expect(dotOf(envRow("prod"))).toBe("rgb(21, 184, 173)");
  });
});

describe("create", () => {
  it("writes once, activates, and stays open on the new environment", async () => {
    const user = userEvent.setup();
    const spies = renderEditor(null);
    const name = screen.getByLabelText(m.nameLabel);
    expect(name).toHaveFocus();
    await user.type(name, "dev");
    await user.click(screen.getByRole("button", { name: m.addVariable }));
    await user.keyboard("HOST{Tab}api{Enter}");
    expect(ipc.envUpsert).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: m.create }));
    await waitFor(() =>
      expect(spies.onStored).toHaveBeenCalledWith({ activated: "dev" }),
    );
    expect(ipc.envUpsert).toHaveBeenCalledTimes(1);
    expect(store.envs.find((env) => env.name === "dev")?.variables).toEqual({
      HOST: "api",
    });
    expect(store.active).toBe("dev");
    await waitFor(() =>
      expect(envRow("dev")).toHaveAttribute("aria-current", "true"),
    );
    expect(screen.getByRole("button", { name: m.renameAria })).toHaveFocus();
    expect(
      screen.getByRole("button", { name: m.deleteEnvironmentAria }),
    ).toBeInTheDocument();
    expect(spies.onClosed).not.toHaveBeenCalled();
  });

  it("Create with an empty name writes nothing and points at the name", async () => {
    const user = userEvent.setup();
    renderEditor(null);
    await user.click(screen.getByRole("button", { name: m.create }));
    expect(screen.getByText(m.nameEmpty)).toBeInTheDocument();
    expect(screen.getByLabelText(m.nameLabel)).toHaveFocus();
    expect(ipc.envUpsert).not.toHaveBeenCalled();
  });

  it("Cancel asks before discarding a named draft, then returns to the environment it came from", async () => {
    const user = userEvent.setup();
    const spies = renderEditor("prod");
    await user.click(
      screen.getByRole("button", { name: m.newEnvironmentAria }),
    );
    await user.type(screen.getByLabelText(m.nameLabel), "tmp");
    expect(
      screen.getByText("tmp", { selector: "nav span" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: m.cancel }));
    const prompt = screen.getByRole("group", { name: m.discardNewTitle });
    await user.click(within(prompt).getByRole("button", { name: m.discard }));
    expect(envRow("prod")).toHaveAttribute("aria-current", "true");
    expect(ipc.envUpsert).not.toHaveBeenCalled();
    expect(spies.onClosed).not.toHaveBeenCalled();
  });
});

describe("rename", () => {
  it("renaming the active environment keeps it active, and Enter returns focus to Rename", async () => {
    const user = userEvent.setup();
    const spies = renderEditor("prod");
    await user.click(screen.getByRole("button", { name: m.renameAria }));
    const input = screen.getByLabelText(m.nameLabel);
    expect(input).toHaveFocus();
    await user.clear(input);
    await user.type(input, "production{Enter}");
    expect(screen.getByRole("button", { name: m.renameAria })).toHaveFocus();
    await waitFor(() =>
      expect(spies.onStored).toHaveBeenCalledWith({ activated: "production" }),
    );
    expect(store.active).toBe("production");
    expect(store.envs.map((env) => env.name)).toEqual(["production"]);
    await waitFor(() =>
      expect(envRow("production")).toHaveAttribute("aria-current", "true"),
    );
  });
});
