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

function setMaxBytes(b: number) {
  function Probe() {
    const [, setPref] = usePrefs();
    useEffect(() => {
      setPref("maxMessageBytes", b);
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

describe("NetworkPane max message size", () => {
  beforeEach(() => setMaxBytes(16 * 1024 * 1024));

  it("commits the Unlimited stop (0) when the slider goes to the end", async () => {
    const user = userEvent.setup();
    render(<NetworkPane />);
    const slider = screen.getByRole("slider", { name: /max message size/i });
    slider.focus();
    await user.keyboard("{End}");
    expect(readPrefs().maxMessageBytes).toBe(0);
  });

  it("commits 1 MiB when the slider goes to the start", async () => {
    const user = userEvent.setup();
    render(<NetworkPane />);
    const slider = screen.getByRole("slider", { name: /max message size/i });
    slider.focus();
    await user.keyboard("{Home}");
    expect(readPrefs().maxMessageBytes).toBe(1 * 1024 * 1024);
  });
});
