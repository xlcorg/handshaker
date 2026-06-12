import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SavedAuthEditor } from "./SavedAuthEditor";
import type { SavedAuthConfigIpc } from "@/ipc/bindings";

vi.mock("@/ipc/client", () => ({
  ipc: {
    envList: vi.fn().mockResolvedValue([{ name: "prod", variables: {}, color: null }]),
    varsResolve: vi.fn(async (t: string) => ({ resolved: t, unresolved_vars: [], cycle_chain: null })),
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

describe("SavedAuthEditor", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the 'no auth' copy for a none config", () => {
    render(<SavedAuthEditor value={{ kind: "none" }} onChange={() => {}} />);
    expect(screen.getByText(/No authentication/i)).toBeInTheDocument();
  });

  it("selecting Bearer emits an env_var config with authorization/'Bearer '", () => {
    const onChange = vi.fn();
    render(<SavedAuthEditor value={{ kind: "none" }} onChange={onChange} />);
    fireEvent.click(screen.getByText("Bearer"));
    expect(onChange).toHaveBeenCalledWith({
      kind: "env_var", env_var: "", header_name: "authorization", prefix: "Bearer ",
      environments: [],
    });
  });

  it("editing the Bearer token emits the env var name", () => {
    const onChange = vi.fn();
    render(
      <SavedAuthEditor
        value={{ kind: "env_var", env_var: "", header_name: "authorization", prefix: "Bearer ", environments: [] }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("BEARER_TOKEN_VAR"), { target: { value: "PROD_TOKEN" } });
    expect(onChange).toHaveBeenCalledWith({
      kind: "env_var", env_var: "PROD_TOKEN", header_name: "authorization", prefix: "Bearer ",
      environments: [],
    });
  });

  it("renders header + value for an api-key config", () => {
    render(
      <SavedAuthEditor
        value={{ kind: "env_var", env_var: "KEY", header_name: "x-api-key", prefix: "", environments: [] }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByDisplayValue("x-api-key")).toBeInTheDocument();
    expect(screen.getByDisplayValue("KEY")).toBeInTheDocument();
  });
});

describe("SavedAuthEditor (oauth2)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the oauth2 fields when the config is oauth2", () => {
    render(<SavedAuthEditor value={oauth2} onChange={() => {}} />);
    expect(screen.getByDisplayValue("https://idp/token")).toBeTruthy();
    expect(screen.getByDisplayValue("cid")).toBeTruthy();
  });

  it("Get token resolves vars, calls the backend, and shows the lifetime", async () => {
    render(<SavedAuthEditor value={oauth2} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /get token/i }));
    await waitFor(() => expect(ipc.authOauth2FetchToken).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/expires in 14 min/i)).toBeTruthy(); // 840s ≈ 14 min
  });

  it("Get token shows a truncated token and copies the full one to the clipboard", async () => {
    render(<SavedAuthEditor value={oauth2} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /get token/i }));
    // Truncated preview — never the full token in the DOM.
    expect(await screen.findByText(/eyJhbGciOiJSUzI1NiJ9…/)).toBeTruthy();
    expect(screen.queryByText("eyJhbGciOiJSUzI1NiJ9.payload.signature")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /copy token/i }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("eyJhbGciOiJSUzI1NiJ9.payload.signature"),
    );
  });

  it("editing a field emits an updated config via onChange", () => {
    const onChange = vi.fn();
    render(<SavedAuthEditor value={oauth2} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue("cid"), { target: { value: "cid2" } });
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls.at(-1)![0] as SavedAuthConfigIpc;
    expect(last.kind === "oauth2_client_credentials" && last.client_id).toBe("cid2");
  });
});
