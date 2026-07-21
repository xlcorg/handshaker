import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";

import { bumpEnvRevision } from "@/features/envs/envRevision";

vi.mock("@/ipc/client", () => ({
  ipc: {
    collectionUpsert: vi.fn().mockResolvedValue(undefined),
    collectionSetVariables: vi.fn().mockResolvedValue(undefined),
    collectionSetNodeAuth: vi.fn().mockResolvedValue(undefined),
    envList: vi.fn().mockResolvedValue([]),
    varsResolve: vi.fn(async (t: string) => ({ resolved: t, unresolved_vars: [], cycle_chain: null })),
  },
}));

import { ipc } from "@/ipc/client";
import { CollectionOverview } from "./CollectionOverview";
import type { CollectionIpc, ItemIpc } from "@/ipc/bindings";

// CollectionTitle + the close button use the `Tooltip` wrapper, which needs a
// TooltipProvider ancestor (supplied globally in `main.tsx`). Wrap renders here.
function r(ui: ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

function req(id: string, name: string): ItemIpc {
  return {
    type: "request", id, name, address_template: "h:443", service: "p.v1.S", method: "GetX",
    body_template: "{}", metadata: [], auth: { kind: "none" }, tls_override: null,
    last_used_at: null, use_count: 0,
  };
}

function collection(over: Partial<CollectionIpc> = {}): CollectionIpc {
  return {
    id: "c1", name: "My Col", items: [req("r1", "GetX")], variables: { base: "x" },
    auth: { kind: "none" }, default_tls: false, skip_tls_verify: false, pinned: false,
    description: null, created_at: 0, expanded: false, ...over,
  };
}

function props(over = {}) {
  return {
    collection: collection(),
    onChanged: vi.fn(),
    onSelectRequest: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("CollectionOverview", () => {
  it("renders the Overview tab with the collection name and counts by default", () => {
    r(<CollectionOverview {...props()} />);
    expect(screen.getByText("My Col")).toBeInTheDocument();
    expect(screen.getByText(/1 request/)).toBeInTheDocument();
  });

  it("shows a request's use_count in the Overview request list", () => {
    const used: ItemIpc = {
      type: "request", id: "r2", name: "Used", address_template: "h:443", service: "p.v1.S",
      method: "GetX", body_template: "{}", metadata: [], auth: { kind: "none" }, tls_override: null,
      last_used_at: 1_700_000_000_000, use_count: 5,
    };
    r(<CollectionOverview {...props({ collection: collection({ items: [used] }) })} />);
    expect(screen.getByText(/5×/)).toBeInTheDocument();
  });

  it("clicking a request row calls onSelectRequest", () => {
    const p = props();
    r(<CollectionOverview {...p} />);
    fireEvent.click(screen.getByText("GetX"));
    expect(p.onSelectRequest).toHaveBeenCalledWith("c1", expect.objectContaining({ id: "r1" }));
  });

  it("toggling TLS persists via collectionUpsert", () => {
    r(<CollectionOverview {...props()} />);
    fireEvent.click(screen.getAllByRole("switch")[0]);
    expect(ipc.collectionUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: "c1", default_tls: true }),
    );
  });

  it("editing the description persists via collectionUpsert", () => {
    r(<CollectionOverview {...props()} />);
    fireEvent.click(screen.getByText(/Add a description/i)); // empty desc → add button
    fireEvent.change(screen.getByPlaceholderText(/Describe what this collection/i), {
      target: { value: "Order APIs" },
    });
    fireEvent.click(screen.getByText("Save"));
    expect(ipc.collectionUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: "c1", description: "Order APIs" }),
    );
  });

  it("the Authorization tab persists a chosen auth via collectionSetNodeAuth", async () => {
    r(<CollectionOverview {...props()} />);
    fireEvent.click(screen.getByText("Authorization"));
    // SavedAuthEditor mounts here and fetches env names in an effect; let that
    // microtask settle inside act() before asserting.
    await act(async () => {});
    fireEvent.click(screen.getByText("Bearer"));
    expect(ipc.collectionSetNodeAuth).toHaveBeenCalledWith("c1", null, {
      kind: "env_var", env_var: "", header_name: "authorization", prefix: "Bearer ",
      environments: [],
    });
  });

  it("the Variables tab persists edits via collectionSetVariables", () => {
    r(<CollectionOverview {...props()} />);
    fireEvent.click(screen.getByText("Variables"));
    fireEvent.change(screen.getByDisplayValue("x"), { target: { value: "y" } });
    expect(ipc.collectionSetVariables).toHaveBeenCalledWith("c1", { base: "y" });
  });

  it("highlights a {{var}} value inline and shows its resolved value", async () => {
    vi.mocked(ipc.varsResolve).mockResolvedValue({
      resolved: "https://api.example.com",
      unresolved_vars: [],
      cycle_chain: null,
      dynamic_vars: [],
    });
    const p = props({ collection: collection({ variables: { "uri-root": "{{notes-api-root}}" } }) });
    r(<CollectionOverview {...p} />);
    fireEvent.click(screen.getByText("Variables"));
    await waitFor(() =>
      expect(screen.getByText("{{notes-api-root}}").className).toContain("vh-resolved"),
    );
    expect(screen.getByText("https://api.example.com")).toBeInTheDocument(); // inline resolved value
    expect(ipc.varsResolve).toHaveBeenCalledWith("{{notes-api-root}}", {
      collection_id: null,
      collection_vars: { "uri-root": "{{notes-api-root}}" },
      env_vars: null,
    });
  });

  it("re-resolves the inline highlight when the environment is edited (envRevision bump)", async () => {
    // Active env initially lacks the referenced var → token highlights as an error.
    vi.mocked(ipc.varsResolve).mockResolvedValue({
      resolved: "{{notes-api-root}}",
      unresolved_vars: ["notes-api-root"],
      cycle_chain: null,
      dynamic_vars: [],
    });
    const p = props({ collection: collection({ variables: { "uri-root": "{{notes-api-root}}" } }) });
    r(<CollectionOverview {...p} />);
    fireEvent.click(screen.getByText("Variables"));
    await waitFor(() =>
      expect(screen.getByText("{{notes-api-root}}").className).toContain("vh-error"),
    );

    // User adds the missing variable in the env editor and saves. Neither the
    // collection rows nor the active env NAME changed, so without the envRevision
    // signal the highlight would stay stale. The backend now resolves it.
    vi.mocked(ipc.varsResolve).mockResolvedValue({
      resolved: "https://api.example.com",
      unresolved_vars: [],
      cycle_chain: null,
      dynamic_vars: [],
    });
    act(() => bumpEnvRevision());
    await waitFor(() =>
      expect(screen.getByText("{{notes-api-root}}").className).toContain("vh-resolved"),
    );
  });

  describe("Links block", () => {
    const links = [
      { name: "Grafana", url: "https://{{host}}/d/abc" },
      { name: "Logs", url: "https://logs.example" },
    ];

    it("renders the collection's links in creation order", () => {
      r(<CollectionOverview {...props({ collection: collection({ links }) })} />);
      const names = screen.getAllByLabelText("link name") as HTMLInputElement[];
      expect(names.map((i) => i.value)).toEqual(["Grafana", "Logs"]);
    });

    it("adding a link persists it via collectionUpsert", () => {
      r(<CollectionOverview {...props()} />);
      fireEvent.click(screen.getByText("Add link"));
      fireEvent.change(screen.getByLabelText("link name"), { target: { value: "Grafana" } });
      fireEvent.change(screen.getByLabelText("link URL"), {
        target: { value: "https://grafana.example" },
      });
      expect(ipc.collectionUpsert).toHaveBeenLastCalledWith(
        expect.objectContaining({
          id: "c1",
          links: [{ name: "Grafana", url: "https://grafana.example" }],
        }),
      );
    });

    it("editing a link's name persists the whole list, order kept", () => {
      r(<CollectionOverview {...props({ collection: collection({ links }) })} />);
      const names = screen.getAllByLabelText("link name");
      fireEvent.change(names[0], { target: { value: "Dashboards" } });
      expect(ipc.collectionUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          links: [{ name: "Dashboards", url: "https://{{host}}/d/abc" }, links[1]],
        }),
      );
    });

    it("deleting a link persists the shortened list", () => {
      r(<CollectionOverview {...props({ collection: collection({ links }) })} />);
      fireEvent.click(screen.getAllByLabelText("Remove link")[0]);
      expect(ipc.collectionUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ links: [links[1]] }),
      );
    });

    it("a link with a blank name and URL is not persisted", () => {
      r(<CollectionOverview {...props()} />);
      fireEvent.click(screen.getByText("Add link"));
      expect(ipc.collectionUpsert).toHaveBeenCalledWith(expect.objectContaining({ links: [] }));
    });

    it("renders a URL template verbatim — resolution is not this ticket's job", () => {
      r(<CollectionOverview {...props({ collection: collection({ links }) })} />);
      const urls = screen.getAllByLabelText("link URL") as HTMLInputElement[];
      expect(urls[0].value).toBe("https://{{host}}/d/abc");
    });
  });

  it("the close button calls onClose", () => {
    const p = props();
    r(<CollectionOverview {...p} />);
    fireEvent.click(screen.getByLabelText("close-overview"));
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });
});
