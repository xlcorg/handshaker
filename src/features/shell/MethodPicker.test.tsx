import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MethodPicker, ServiceGroupLabel } from "./MethodPicker";
import type { SelectedMethod } from "./SelectedMethod";
import type { ServiceCatalogIpc } from "@/ipc/bindings";

const empty: SelectedMethod = { service: "", method: "", kind: "unary" };

const CATALOG: ServiceCatalogIpc = {
  services: [
    {
      full_name: "myapp.user.v1.UserService",
      methods: [
        {
          name: "GetUser",
          path: "/myapp.user.v1.UserService/GetUser",
          input_message: "GetUserReq",
          output_message: "User",
          client_streaming: false,
          server_streaming: false,
        },
      ],
    },
  ],
};

describe("MethodPicker trigger", () => {
  it("shows the 'Select a method' placeholder when nothing is selected", () => {
    render(<MethodPicker selected={empty} catalog={null} onSelect={vi.fn()} />);
    expect(screen.getByText("Select a method")).toBeInTheDocument();
  });

  it("shows the method name when a method is selected (even without catalog)", () => {
    render(
      <MethodPicker
        selected={{ service: "p.v1.S", method: "GetX", kind: "unary" }}
        catalog={null}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("GetX")).toBeInTheDocument();
  });

  it("exposes the full service/method path as a tooltip on the trigger", () => {
    render(
      <MethodPicker
        selected={{ service: "myapp.user.v1.UserService", method: "GetUser", kind: "unary" }}
        catalog={null}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByTitle("myapp.user.v1.UserService/GetUser")).toBeInTheDocument();
  });

  it("does not hard-cap label segments to a fixed pixel width", () => {
    // Regression: each segment used a fixed `maxWidth: 160` that truncated text even
    // when the flex-1 trigger had plenty of room. Truncation must come from the flex
    // layout (min-w-0 + truncate), not an inline pixel cap.
    render(
      <MethodPicker
        selected={{ service: "myapp.user.v1.UserService", method: "GetUser", kind: "unary" }}
        catalog={null}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("GetUser").style.maxWidth).toBe("");
    expect(screen.getByText("UserService").style.maxWidth).toBe("");
  });
});

describe("MethodPicker group style", () => {
  beforeEach(() => localStorage.clear());

  it("tags the open method list with the selected group style (default 'zebra')", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<MethodPicker selected={empty} catalog={CATALOG} onSelect={vi.fn()} />);
    await user.click(screen.getByRole("button"));
    const list = document.querySelector("[data-mp-style]");
    expect(list).not.toBeNull();
    expect(list!.getAttribute("data-mp-style")).toBe("zebra");
  });
});

describe("ServiceGroupLabel", () => {
  const full = "myapp.user.v1.UserService";
  const short = "UserService";

  it("renders the short service name and the full dotted path side by side", () => {
    render(<ServiceGroupLabel full={full} short={short} />);
    // The short name is always shown as its own element (exact text match).
    expect(screen.getByText(short)).toBeInTheDocument();
    // The full path is shown as secondary text.
    expect(screen.getByText(full)).toBeInTheDocument();
  });

  it("exposes the full path as a tooltip", () => {
    render(<ServiceGroupLabel full={full} short={short} />);
    expect(screen.getByTitle(full)).toBeInTheDocument();
  });
});
