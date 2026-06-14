import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { splashFadeMs, dismissSplash } from "./splash";

beforeEach(() => {
  document.body.innerHTML = "";
  delete (window as unknown as { __splashKill?: number }).__splashKill;
  // jsdom не реализует matchMedia — мок по умолчанию: reduced-motion выключен.
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  vi.useRealTimers();
});

function mountSplash(): HTMLElement {
  const el = document.createElement("div");
  el.id = "splash";
  document.body.appendChild(el);
  return el;
}

describe("splashFadeMs", () => {
  it("is 0 under reduced motion, else the fade duration", () => {
    expect(splashFadeMs(true)).toBe(0);
    expect(splashFadeMs(false)).toBe(200);
    expect(splashFadeMs(false, 300)).toBe(300);
  });
});

describe("dismissSplash", () => {
  it("adds .is-hiding then removes #splash after the fade", () => {
    vi.useFakeTimers();
    mountSplash();
    dismissSplash();
    expect(document.getElementById("splash")?.classList.contains("is-hiding")).toBe(true);
    expect(document.getElementById("splash")).not.toBeNull();
    vi.advanceTimersByTime(200);
    expect(document.getElementById("splash")).toBeNull();
  });

  it("removes immediately under reduced motion (fade 0)", () => {
    vi.useFakeTimers();
    (window.matchMedia as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ matches: true });
    mountSplash();
    dismissSplash();
    vi.runAllTimers();
    expect(document.getElementById("splash")).toBeNull();
  });

  it("is a no-op when #splash is absent", () => {
    expect(() => dismissSplash()).not.toThrow();
  });

  it("clears the safety timeout once the overlay is removed", () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(window, "clearTimeout");
    (window as unknown as { __splashKill?: number }).__splashKill = 123;
    mountSplash();
    dismissSplash();
    vi.advanceTimersByTime(200);
    expect(clearSpy).toHaveBeenCalledWith(123);
  });
});
