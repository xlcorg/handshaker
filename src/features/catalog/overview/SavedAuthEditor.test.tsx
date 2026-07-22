import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { SavedAuthEditor } from "./SavedAuthEditor";
import type { SavedAuthConfigIpc } from "@/ipc/bindings";
import { messages } from "@/lib/messages";

const m = messages.catalog.overview.auth;

vi.mock("@/ipc/client", () => ({
  ipc: {
    envList: vi.fn().mockResolvedValue([{ name: "prod", variables: {}, color: null }]),
    varsResolve: vi.fn(async (t: string) => ({ resolved: t, unresolved_vars: [], cycle_chain: null, dynamic_vars: [] })),
    authOauth2FetchToken: vi
      .fn()
      .mockResolvedValue({ access_token: "eyJhbGciOiJSUzI1NiJ9.payload.signature", expires_in_secs: 840 }),
  },
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn().mockResolvedValue(undefined) }));
import { ipc } from "@/ipc/client";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

const oauth2: SavedAuthConfigIpc = {
  kind: "oauth2_client_credentials",
  token_url: "https://idp/token",
  client_id: "cid",
  client_secret: "{{secret}}",
  scopes: ["api"],
  header_name: "authorization",
  prefix: "Bearer ",
  environments: [],
};

/**
 * SavedAuthEditor fetches env names in a mount effect (`ipc.envList().then(setEnvNames)`),
 * so a bare `render` leaves a state update to land after the test's sync assertions —
 * outside act(). Flush that microtask inside act() before asserting.
 */
async function renderEditor(ui: Parameters<typeof render>[0]) {
  const result = render(ui);
  await act(async () => {});
  return result;
}

describe("SavedAuthEditor", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the 'no auth' copy for a none config", async () => {
    await renderEditor(<SavedAuthEditor value={{ kind: "none" }} onChange={() => {}} />);
    expect(screen.getByText(m.none)).toBeInTheDocument();
  });

  it("selecting Bearer emits an env_var config with authorization/'Bearer '", async () => {
    const onChange = vi.fn();
    await renderEditor(<SavedAuthEditor value={{ kind: "none" }} onChange={onChange} />);
    fireEvent.click(screen.getByText(m.kinds.bearer));
    expect(onChange).toHaveBeenCalledWith({
      kind: "env_var", env_var: "", header_name: "authorization", prefix: "Bearer ",
      environments: [],
    });
  });

  it("editing the Bearer token emits the env var name", async () => {
    const onChange = vi.fn();
    await renderEditor(
      <SavedAuthEditor
        value={{ kind: "env_var", env_var: "", header_name: "authorization", prefix: "Bearer ", environments: [] }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(m.tokenPlaceholder), { target: { value: "PROD_TOKEN" } });
    expect(onChange).toHaveBeenCalledWith({
      kind: "env_var", env_var: "PROD_TOKEN", header_name: "authorization", prefix: "Bearer ",
      environments: [],
    });
  });

  it("renders header + value for an api-key config; the default header shows as a placeholder", async () => {
    await renderEditor(
      <SavedAuthEditor
        value={{ kind: "env_var", env_var: "KEY", header_name: "x-api-key", prefix: "", environments: [] }}
        onChange={() => {}}
      />,
    );
    // The kind-default header seeds an empty field showing the placeholder, not a value.
    const header = screen.getByPlaceholderText(m.headerNamePlaceholderApiKey);
    expect(header).toHaveValue("");
    expect(screen.getByDisplayValue("KEY")).toBeInTheDocument();
  });

  it("shows an editable Prefix field for an api-key config and persists it", async () => {
    const onChange = vi.fn();
    await renderEditor(
      <SavedAuthEditor
        value={{ kind: "env_var", env_var: "KEY", header_name: "x-custom", prefix: "Token", environments: [] }}
        onChange={onChange}
      />,
    );
    const prefix = screen.getByDisplayValue("Token");
    fireEvent.change(prefix, { target: { value: "Api" } });
    const last = onChange.mock.calls.at(-1)![0] as SavedAuthConfigIpc;
    expect(last.kind === "env_var" && last.prefix).toBe("Api");
  });

  it("clearing Header name leaves the field empty on screen while the emitted config keeps the default", async () => {
    const onChange = vi.fn();
    await renderEditor(
      <SavedAuthEditor
        value={{ kind: "env_var", env_var: "KEY", header_name: "custom-key", prefix: "", environments: [] }}
        onChange={onChange}
      />,
    );
    const field = screen.getByDisplayValue("custom-key");
    fireEvent.change(field, { target: { value: "" } });
    // The input keeps what the user left, even though the persisted config falls back to the default.
    expect(field).toHaveValue("");
    const last = onChange.mock.calls.at(-1)![0] as SavedAuthConfigIpc;
    expect(last.kind === "env_var" && last.header_name).toBe("x-api-key");
  });

  it("a persist→reload echo of the same collection does not clobber an in-progress edit", async () => {
    const onChange = vi.fn();
    const value: SavedAuthConfigIpc = {
      kind: "env_var", env_var: "KEY", header_name: "x-api-key", prefix: "", environments: [],
    };
    const { rerender } = await renderEditor(
      <SavedAuthEditor value={value} onChange={onChange} seedKey="col-1" />,
    );
    // The default header seeds empty (placeholder); type a custom value into it.
    fireEvent.change(screen.getByPlaceholderText(m.headerNamePlaceholderApiKey), { target: { value: "my-header" } });
    // Same collection re-renders with the stale (pre-edit) value — the buffer must win.
    rerender(<SavedAuthEditor value={value} onChange={onChange} seedKey="col-1" />);
    await act(async () => {});
    expect(screen.getByDisplayValue("my-header")).toBeInTheDocument();
  });

  it("switching to a different collection re-seeds the form", async () => {
    const { rerender } = await renderEditor(
      <SavedAuthEditor
        value={{ kind: "env_var", env_var: "KEY", header_name: "header-a", prefix: "", environments: [] }}
        onChange={() => {}}
        seedKey="col-a"
      />,
    );
    expect(screen.getByDisplayValue("header-a")).toBeInTheDocument();
    rerender(
      <SavedAuthEditor
        value={{ kind: "env_var", env_var: "KEY", header_name: "header-b", prefix: "", environments: [] }}
        onChange={() => {}}
        seedKey="col-b"
      />,
    );
    await act(async () => {});
    expect(screen.getByDisplayValue("header-b")).toBeInTheDocument();
  });
});

describe("SavedAuthEditor (dead env names in Apply in environments)", () => {
  beforeEach(() => vi.clearAllMocks());

  const withEnvs = (environments: string[]): SavedAuthConfigIpc => ({
    kind: "env_var",
    env_var: "KEY",
    header_name: "x-api-key",
    prefix: "",
    environments,
  });

  it("marks a dead env name struck-through in the summary button; live names unchanged", async () => {
    // envList mock returns only "prod"; "staging" is dead.
    await renderEditor(<SavedAuthEditor value={withEnvs(["prod", "staging"])} onChange={() => {}} />);
    const staging = screen.getByTitle(m.envDeletedTitle);
    expect(staging).toHaveTextContent("staging");
    expect(staging.className).toContain("line-through");
    // The live name has no deleted title.
    expect(screen.getByText("prod").getAttribute("title")).toBeNull();
  });

  it("shows the dead name (marked) inside the popover so it can be unchecked", async () => {
    await renderEditor(<SavedAuthEditor value={withEnvs(["prod", "staging"])} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /prod|staging/ }));
    // The deleted hint copy appears for the dead row.
    expect(screen.getByText(m.envDeletedHint)).toBeInTheDocument();
  });

  it("unchecking a dead name removes it from the persisted gating list", async () => {
    const onChange = vi.fn();
    await renderEditor(<SavedAuthEditor value={withEnvs(["prod", "staging"])} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /prod|staging/ }));
    // Click the dead row inside the popover.
    const deadRow = screen.getByText(m.envDeletedHint).closest("button")!;
    fireEvent.click(deadRow);
    const last = onChange.mock.calls.at(-1)![0] as SavedAuthConfigIpc;
    expect(last.kind === "env_var" && last.environments).toEqual(["prod"]);
  });
});

describe("SavedAuthEditor (oauth2)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the oauth2 fields when the config is oauth2", async () => {
    await renderEditor(<SavedAuthEditor value={oauth2} onChange={() => {}} />);
    expect(screen.getByDisplayValue("https://idp/token")).toBeTruthy();
    expect(screen.getByDisplayValue("cid")).toBeTruthy();
  });

  it("Get token resolves vars, calls the backend, and shows the lifetime", async () => {
    await renderEditor(<SavedAuthEditor value={oauth2} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: m.getToken }));
    await waitFor(() => expect(ipc.authOauth2FetchToken).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(m.tokenExpiry(14))).toBeTruthy(); // 840s ≈ 14 min
  });

  it("Get token shows a truncated token and copies the full one to the clipboard", async () => {
    await renderEditor(<SavedAuthEditor value={oauth2} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: m.getToken }));
    // Truncated preview — never the full token in the DOM.
    expect(await screen.findByText(/eyJhbGciOiJSUzI1NiJ9…/)).toBeTruthy();
    expect(screen.queryByText("eyJhbGciOiJSUzI1NiJ9.payload.signature")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: m.copyToken }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("eyJhbGciOiJSUzI1NiJ9.payload.signature"),
    );
  });

  it("editing a field emits an updated config via onChange", async () => {
    const onChange = vi.fn();
    await renderEditor(<SavedAuthEditor value={oauth2} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue("cid"), { target: { value: "cid2" } });
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls.at(-1)![0] as SavedAuthConfigIpc;
    expect(last.kind === "oauth2_client_credentials" && last.client_id).toBe("cid2");
  });
});

describe("SavedAuthEditor (oauth2 var highlighting)", () => {
  beforeEach(() => vi.clearAllMocks());

  // Resolver honest to Send: `{{known}}` resolves (env/collection var), anything else fails.
  const resolver = vi.fn(async (t: string) => {
    const names = [...t.matchAll(/\{\{([^{}]+)\}\}/g)].map((mm) => mm[1]);
    const unresolved = names.filter((n) => n !== "known");
    return { resolved: t, unresolved_vars: unresolved, cycle_chain: null, dynamic_vars: [] };
  });
  const candidates = [{ name: "known", value: "v", origin: "collection" as const }];

  it("exposes the four oauth2 fields as var-highlight comboboxes", async () => {
    await renderEditor(
      <SavedAuthEditor value={oauth2} onChange={() => {}} resolver={resolver} resolveKey="k" variables={candidates} />,
    );
    expect(screen.getByRole("combobox", { name: m.tokenUrl })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: m.clientId })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: m.clientSecret })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: m.scope })).toBeInTheDocument();
  });

  it("colors a resolvable var green and an unknown one red (matches Send)", async () => {
    const cfg: SavedAuthConfigIpc = { ...oauth2, token_url: "{{known}}", client_id: "{{missing}}" };
    await renderEditor(
      <SavedAuthEditor value={cfg} onChange={() => {}} resolver={resolver} resolveKey="k" variables={candidates} />,
    );
    await waitFor(() => {
      expect(document.querySelector(".vh-resolved")).toHaveTextContent("{{known}}");
      expect(document.querySelector(".vh-error")).toHaveTextContent("{{missing}}");
    });
  });
});
