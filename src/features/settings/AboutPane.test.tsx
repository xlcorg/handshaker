import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AboutPane } from "./AboutPane";
import { UpdaterProvider } from "@/features/updater/updaterContext";
import type { UseUpdateCheck } from "@/features/updater/useUpdateCheck";

vi.mock("@/ipc/client", () => ({
  ipc: { appVersion: vi.fn().mockResolvedValue("1.2.3") },
}));

function makeUpdater(over: Partial<UseUpdateCheck> = {}): UseUpdateCheck {
  return {
    phase: "idle",
    version: "",
    progress: 0,
    manual: false,
    hasUpdate: false,
    install: async () => {},
    dismiss: () => {},
    recheck: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AboutPane", () => {
  it("renders a Check for updates button that triggers a recheck", async () => {
    const recheck = vi.fn();
    const user = userEvent.setup();
    render(
      <UpdaterProvider value={makeUpdater({ recheck })}>
        <AboutPane />
      </UpdaterProvider>,
    );
    await user.click(screen.getByRole("button", { name: /check for updates/i }));
    expect(recheck).toHaveBeenCalledTimes(1);
  });

  it("disables the button while a check is in flight", () => {
    render(
      <UpdaterProvider value={makeUpdater({ phase: "checking" })}>
        <AboutPane />
      </UpdaterProvider>,
    );
    expect(screen.getByRole("button", { name: /checking/i })).toBeDisabled();
  });
});
