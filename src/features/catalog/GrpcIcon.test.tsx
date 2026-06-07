import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { GrpcIconStyle } from "@/lib/use-prefs";
import { GrpcIcon } from "./GrpcIcon";

const variants: GrpcIconStyle[] = ["solid", "letter", "outline", "circle"];

describe("GrpcIcon", () => {
  afterEach(() => cleanup());

  it.each(variants)("variant=%s has aria-label='grpc' and data-variant=%s", (v) => {
    render(<GrpcIcon variant={v} />);
    const el = screen.getByLabelText("grpc");
    expect(el).toBeTruthy();
    expect(el.getAttribute("data-variant")).toBe(v);
    cleanup();
  });

  it("four variants produce four distinct data-variant values", () => {
    const seen = new Set<string>();
    for (const v of variants) {
      render(<GrpcIcon variant={v} />);
      const el = screen.getByLabelText("grpc");
      seen.add(el.getAttribute("data-variant") ?? "");
      cleanup();
    }
    expect(seen.size).toBe(4);
  });
});
