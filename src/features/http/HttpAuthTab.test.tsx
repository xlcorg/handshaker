import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { RequestAuthIpc, SavedAuthConfigIpc } from "@/ipc/bindings";
import { messages } from "@/lib/messages";
import { HttpAuthTab } from "./HttpAuthTab";

vi.mock("@/ipc/client", () => ({
  ipc: {
    envList: vi.fn().mockResolvedValue([]),
    authOauth2Preview: vi.fn(),
  },
}));

const bearer: SavedAuthConfigIpc = {
  kind: "env_var",
  env_var: "TOK",
  header_name: "authorization",
  prefix: "Bearer ",
  environments: [],
};

const copy = messages.http.auth;

function renderTab(auth: RequestAuthIpc, collection: { name: string; auth: SavedAuthConfigIpc } | null, onChange = vi.fn()) {
  render(
    <HttpAuthTab draftId="draft-1" auth={auth} collection={collection} onChange={onChange} />,
  );
  return onChange;
}

describe("HttpAuthTab", () => {
  it("shows the inherit sentence, writes explicit none, and the first Bearer click is not none", () => {
    const onChange = renderTab({ kind: "inherit" }, { name: "Notes", auth: bearer });
    expect(screen.getByText(copy.applies(messages.catalog.overview.auth.kinds.bearer, "Notes"))).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(messages.catalog.overview.auth.tokenPlaceholder)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: copy.inherit }));
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("radio", { name: messages.catalog.overview.auth.kinds.none }));
    expect(onChange).toHaveBeenCalledWith({ kind: "override", config: { kind: "none" } });

    onChange.mockClear();
    fireEvent.click(screen.getByRole("radio", { name: messages.catalog.overview.auth.kinds.bearer }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      kind: "override",
      config: {
        kind: "env_var",
        env_var: "",
        header_name: "authorization",
        prefix: "Bearer ",
        environments: [],
      },
    });
    expect(onChange).not.toHaveBeenCalledWith({ kind: "override", config: { kind: "none" } });
  });
});
