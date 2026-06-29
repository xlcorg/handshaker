import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { VarResolveLine, hasVars } from "./VarResolveLine";

const report = (over: Partial<{ resolved: string; unresolved_vars: string[]; cycle_chain: string[] | null }> = {}) => ({
  resolved: "ok", unresolved_vars: [], cycle_chain: null, dynamic_vars: [], ...over,
});

async function flushDebounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

describe("hasVars", () => {
  it("detects {{name}} placeholders", () => {
    expect(hasVars("{{uri-root}}/v1")).toBe(true);
    expect(hasVars("plain")).toBe(false);
  });
});

describe("VarResolveLine", () => {
  it("renders nothing for a value without vars", () => {
    vi.useFakeTimers();
    const resolver = vi.fn();
    const { container } = render(<VarResolveLine value="plain" resolver={resolver} />);
    expect(container).toBeEmptyDOMElement();
    expect(resolver).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("shows the resolved value after the debounce", async () => {
    vi.useFakeTimers();
    const resolver = vi.fn(async () => report({ resolved: "https://api.example.com" }));
    render(<VarResolveLine value="{{notes-api-root}}" resolver={resolver} />);
    expect(screen.queryByText(/resolves/)).toBeNull(); // still debouncing
    await flushDebounce();
    expect(screen.getByText(/→ resolves: https:\/\/api\.example\.com/)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("shows unresolved vars as a warning", async () => {
    vi.useFakeTimers();
    const resolver = vi.fn(async () => report({ unresolved_vars: ["notes-api-root"] }));
    render(<VarResolveLine value="{{notes-api-root}}" resolver={resolver} />);
    await flushDebounce();
    expect(screen.getByText(/⚠ Unresolved: notes-api-root/)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("shows a cycle chain as a warning", async () => {
    vi.useFakeTimers();
    const resolver = vi.fn(async () => report({ cycle_chain: ["a", "b", "a"] }));
    render(<VarResolveLine value="{{a}}" resolver={resolver} />);
    await flushDebounce();
    expect(screen.getByText(/⚠ Cycle: a → b → a/)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("re-resolves when resolveKey changes", async () => {
    vi.useFakeTimers();
    const resolver = vi.fn(async () => report());
    const { rerender } = render(
      <VarResolveLine value="{{x}}" resolver={resolver} resolveKey="k1" />,
    );
    await flushDebounce();
    rerender(<VarResolveLine value="{{x}}" resolver={resolver} resolveKey="k2" />);
    await flushDebounce();
    expect(resolver).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
