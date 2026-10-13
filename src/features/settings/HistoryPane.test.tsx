import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { messages } from "@/lib/messages";
import { readPrefs, setPref } from "@/lib/use-prefs";
import { SettingsDialog } from "./SettingsDialog";

const t = messages.settings;

beforeEach(() => {
  localStorage.clear();
  setPref("confirmClearHistory", true);
});

describe("Settings history confirmation", () => {
  it("starts on and writes the pref when the switch is turned off", async () => {
    const user = userEvent.setup();
    render(<SettingsDialog open onOpenChange={() => {}} />);

    await user.click(screen.getByRole("button", { name: t.sections.history }));

    const toggle = screen.getByRole("switch", { name: t.history.confirmClear });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(t.history.confirmClearHint)).toBeInTheDocument();

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(readPrefs().confirmClearHistory).toBe(false);
    expect(
      JSON.parse(localStorage.getItem("handshaker.prefs.v1")!)
        .confirmClearHistory,
    ).toBe(false);
  });
});
