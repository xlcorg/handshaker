import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect } from "vitest";

// Node >= 22 defines global `localStorage`/`sessionStorage` getters that
// return undefined unless node runs with --localstorage-file; under vitest
// they shadow jsdom's Storage. Install an in-memory Storage unconditionally —
// merely *reading* node's getter emits an ExperimentalWarning per worker, so
// the shim must never probe the existing value.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  key(index: number) {
    return [...this.store.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.store.set(key, String(value));
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}
for (const name of ["localStorage", "sessionStorage"] as const) {
  const storage = new MemoryStorage();
  const descriptor = { value: storage, configurable: true, writable: true };
  Object.defineProperty(globalThis, name, descriptor);
  if (typeof window !== "undefined" && window !== globalThis) {
    Object.defineProperty(window, name, descriptor);
  }
}

// jsdom ships without the async Clipboard API. Provide a stub object so tests
// can `vi.spyOn(navigator.clipboard, "writeText")` (jsdom has no clipboard to
// spy on otherwise). Individual tests still mock the implementation.
if (!navigator.clipboard) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: async () => undefined, readText: async () => "" },
    configurable: true,
    writable: true,
  });
}

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (!globalThis.ResizeObserver)
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
if (!window.matchMedia) {
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
  })) as unknown as typeof window.matchMedia;
}
// Radix UI components rely on PointerEvents APIs that jsdom does not implement.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// Any console.error / console.warn a test produces fails that test. React's act(...)
// warnings and Radix's a11y warnings both arrive on these channels, so this turns "the
// suite is noisy" into "the suite is red" — a new warning can no longer hide among old
// ones.
//
// The assertion runs in afterEach rather than throwing from inside console.error: React
// logs during render, and an exception thrown from there is swallowed by an error
// boundary, burying the real failure under unrelated noise.
//
// Installed by plain assignment, not vi.spyOn: a vi mock is subject to vi's
// mock-management functions, and a `vi.resetAllMocks()` in some other test's beforeEach
// (an ordinary idiom) would strip the implementation, silently disarming the guard —
// console output would vanish instead of being captured, and the test would pass green
// with no stderr. Plain assignment is invisible to vi.resetAllMocks/restoreAllMocks.
//
// A test that legitimately expects console output opts out the way
// src/features/updater/updaterContext.test.tsx does — a local
// vi.spyOn(console, "error").mockImplementation(() => {}) restored in a finally. vi.spyOn
// captures whatever is currently installed (this guard's handler), so its mockRestore
// puts the handler back rather than the raw console, and the opt-out composes.
//
// Reach: this only covers console.error/warn calls made from within a test body. Output
// from beforeAll/afterAll hooks or module top-level runs outside beforeEach/afterEach and
// escapes the guard, as does console.log/info/debug on any other channel.
const GUARDED_CHANNELS = ["error", "warn"] as const;

const ORIGINAL_CONSOLE = Object.fromEntries(
  GUARDED_CHANNELS.map((channel) => [channel, console[channel]]),
) as Record<(typeof GUARDED_CHANNELS)[number], typeof console.error>;

let capturedConsoleOutput: string[] = [];

beforeEach(() => {
  capturedConsoleOutput = [];
  for (const channel of GUARDED_CHANNELS) {
    console[channel] = (...args: unknown[]) => {
      capturedConsoleOutput.push(`console.${channel}: ${args.map(String).join(" ")}`);
    };
  }
});

afterEach(() => {
  const output = capturedConsoleOutput;
  capturedConsoleOutput = [];
  // Restore the original console functions directly — a test that opted out via
  // vi.spyOn(...).mockRestore() already put its own value back, so this only fires for
  // tests that never touched the spy.
  for (const channel of GUARDED_CHANNELS) {
    console[channel] = ORIGINAL_CONSOLE[channel];
  }
  expect(output.join("\n\n")).toBe("");
});
