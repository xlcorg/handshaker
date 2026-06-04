import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { NetworkPane } from "./NetworkPane";
import { readPrefs, usePrefs } from "@/lib/use-prefs";

/** Reset the prefs singleton to a known deadline via the public setter. */
function setDeadlineMs(ms: number) {
  function Probe() {
    const [, setPref] = usePrefs();
    useEffect(() => {
      setPref("requestTimeoutMs", ms);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return null;
  }
  render(<Probe />);
}

describe("NetworkPane request deadline", () => {
  beforeEach(() => setDeadlineMs(30000));

  it("shows the deadline in seconds and writes ms back on change", async () => {
    const user = userEvent.setup();
    render(<NetworkPane />);
    const input = screen.getByLabelText(/request deadline/i) as HTMLInputElement;
    expect(input.value).toBe("30");
    await user.clear(input);
    await user.type(input, "45");
    await user.tab(); // commit on blur
    expect(readPrefs().requestTimeoutMs).toBe(45000);
  });

  it("clamps sub-second input to the 1000 ms floor", async () => {
    const user = userEvent.setup();
    render(<NetworkPane />);
    const input = screen.getByLabelText(/request deadline/i) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "0");
    await user.tab();
    expect(readPrefs().requestTimeoutMs).toBe(1000);
  });
});
