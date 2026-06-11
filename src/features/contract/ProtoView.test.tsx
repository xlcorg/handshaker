import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProtoView } from "./ProtoView";
import type { ProtoDoc } from "./proto";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      value: (query: string) => ({
        matches: false, media: query,
        addEventListener: () => {}, removeEventListener: () => {},
      }),
    });
  }
});

const DOC: ProtoDoc = {
  blocks: [
    {
      fullName: "t.Req",
      lines: [
        [
          { kind: "keyword", text: "message " },
          { kind: "name", text: "Req", tooltip: "t.Req" },
          { kind: "punct", text: " {" },
        ],
        [
          { kind: "punct", text: "  " },
          { kind: "typeRef", text: "Item", target: "t.Item", tooltip: "t.Item" },
          { kind: "punct", text: " " },
          { kind: "name", text: "an_item", tooltip: "anItem" },
          { kind: "punct", text: " = 1;" },
        ],
        [{ kind: "punct", text: "}" }],
      ],
    },
    {
      fullName: "t.Item",
      lines: [[
        { kind: "keyword", text: "message " },
        { kind: "name", text: "Item", tooltip: "t.Item" },
        { kind: "punct", text: " {}" },
      ]],
    },
  ],
};

describe("ProtoView", () => {
  it("renders tokens with kind classes and tooltips", () => {
    const { container } = render(<ProtoView doc={DOC} />);
    const field = screen.getByText("an_item");
    expect(field).toHaveAttribute("title", "anItem");
    expect(field.className).toContain("hs-proto-name");
    expect(container.querySelector(".hs-proto-kw")).not.toBeNull();
    expect(container.querySelector(".hs-proto-punct")).not.toBeNull();
  });

  it("clicking a type ref scrolls its block into view and flashes it", () => {
    const { container } = render(<ProtoView doc={DOC} />);
    fireEvent.click(screen.getByRole("button", { name: "Item" }));
    const target = container.querySelector('[data-block="t.Item"]') as HTMLElement;
    expect(target.classList.contains("hs-proto-flash")).toBe(true);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });
});
