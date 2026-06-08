import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const { appVersion } = vi.hoisted(() => ({ appVersion: vi.fn() }));
vi.mock("@/ipc/client", () => ({ ipc: { appVersion: () => appVersion() } }));

import { AppVersionBadge } from "./AppVersionBadge";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AppVersionBadge", () => {
  it("shows the resolved app version (prefixed with v)", async () => {
    appVersion.mockResolvedValue("1.2.3");
    render(<AppVersionBadge />);
    await waitFor(() => expect(screen.getByText("v1.2.3")).toBeInTheDocument());
  });

  it("renders nothing before the version resolves and after a failure", async () => {
    appVersion.mockRejectedValue(new Error("not running in tauri"));
    const { container } = render(<AppVersionBadge />);
    expect(container).toBeEmptyDOMElement();
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
