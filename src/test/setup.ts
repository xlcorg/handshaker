import "@testing-library/jest-dom/vitest";

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
