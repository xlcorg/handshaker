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
